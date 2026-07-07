using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using NexusChat.Application.Interfaces;
using NexusChat.Application.DTOs;

namespace NexusChat.API.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly IUserConnectionManager _connectionManager;
    private readonly IChatService _chatService;

    public ChatHub(IUserConnectionManager connectionManager, IChatService chatService)
    {
        _connectionManager = connectionManager;
        _chatService = chatService;
    }

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(userId))
        {
            _connectionManager.KeepUserConnection(userId, Context.ConnectionId);
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _connectionManager.RemoveUserConnection(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<MessageDto?> SendMessageToUser(string receiverId, string content)
    {
        var senderIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(senderIdStr) || !Guid.TryParse(senderIdStr, out var senderId))
            return null;

        if (!Guid.TryParse(receiverId, out var receiverGuid))
            return null;

        // Ensure a private conversation exists between the two users
        var conversation = await _chatService.GetOrCreatePrivateConversationAsync(senderId, receiverGuid);
        if (conversation == null) return null;

        // Save message to DB
        var messageDto = await _chatService.SendMessageAsync(senderId, conversation.Id, content);

        // Broadcast to receiver's devices
        var receiverConnections = _connectionManager.GetUserConnections(receiverId);
        if (receiverConnections.Any())
        {
            await Clients.Clients(receiverConnections).SendAsync("ReceiveMessage", messageDto);
        }

        // Broadcast to sender's other devices (optional but good for syncing)
        var senderConnections = _connectionManager.GetUserConnections(senderIdStr).Where(c => c != Context.ConnectionId).ToList();
        if (senderConnections.Any())
        {
            await Clients.Clients(senderConnections).SendAsync("ReceiveMessage", messageDto);
        }
        
        return messageDto;
    }

    public async Task<MessageDto?> SendMessageToGroup(Guid conversationId, string content)
    {
        var senderIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(senderIdStr) || !Guid.TryParse(senderIdStr, out var senderId))
            return null;

        var isApproved = await _chatService.IsApprovedParticipantAsync(conversationId, senderId);
        if (!isApproved)
            return null;

        // Save message to DB
        var messageDto = await _chatService.SendMessageAsync(senderId, conversationId, content);

        // Broadcast to group (except sender to avoid duplicate if we rely on return value, but here we just return it)
        await Clients.GroupExcept(conversationId.ToString(), Context.ConnectionId).SendAsync("ReceiveMessage", messageDto);
        
        return messageDto;
    }

    public async Task JoinGroup(Guid conversationId)
    {
        var userIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
            return;
            
        var isApproved = await _chatService.IsApprovedParticipantAsync(conversationId, userId);
        if (isApproved)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, conversationId.ToString());
        }
    }

    public async Task LeaveGroup(Guid conversationId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, conversationId.ToString());
    }

    public async Task MarkAsRead(Guid messageId)
    {
        var msg = await _chatService.MarkMessageAsReadAsync(messageId);
        if (msg != null)
        {
            var senderConnections = _connectionManager.GetUserConnections(msg.SenderId.ToString());
            if (senderConnections.Any())
            {
                await Clients.Clients(senderConnections).SendAsync("MessageRead", messageId);
            }
        }
    }

    // --- Edit & Delete Messages ---

    public async Task<MessageDto?> EditMessage(Guid messageId, string newContent)
    {
        var userIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
            return null;

        var result = await _chatService.EditMessageAsync(messageId, userId, newContent);
        if (result == null) return null;

        // Broadcast edit to conversation participants
        await Clients.GroupExcept(result.ConversationId.ToString(), Context.ConnectionId)
            .SendAsync("MessageEdited", result);

        // Also broadcast to private chat partner if not a group
        var senderConnections = _connectionManager.GetUserConnections(userIdStr)
            .Where(c => c != Context.ConnectionId).ToList();
        if (senderConnections.Any())
        {
            await Clients.Clients(senderConnections).SendAsync("MessageEdited", result);
        }

        return result;
    }

    public async Task<MessageDto?> DeleteMessage(Guid messageId)
    {
        var userIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
            return null;

        var result = await _chatService.DeleteMessageAsync(messageId, userId);
        if (result == null) return null;

        // Broadcast delete to conversation participants
        await Clients.GroupExcept(result.ConversationId.ToString(), Context.ConnectionId)
            .SendAsync("MessageDeleted", result);

        var senderConnections = _connectionManager.GetUserConnections(userIdStr)
            .Where(c => c != Context.ConnectionId).ToList();
        if (senderConnections.Any())
        {
            await Clients.Clients(senderConnections).SendAsync("MessageDeleted", result);
        }

        return result;
    }

    // --- Typing Indicators ---

    public async Task Typing(string receiverId, bool isGroup)
    {
        var senderIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(senderIdStr)) return;

        if (isGroup)
        {
            if (Guid.TryParse(receiverId, out var convId))
            {
                if (await _chatService.IsApprovedParticipantAsync(convId, Guid.Parse(senderIdStr)))
                {
                    await Clients.GroupExcept(receiverId, Context.ConnectionId).SendAsync("UserTyping", senderIdStr, true);
                }
            }
        }
        else
        {
            var receiverConnections = _connectionManager.GetUserConnections(receiverId);
            if (receiverConnections.Any())
            {
                await Clients.Clients(receiverConnections).SendAsync("UserTyping", senderIdStr, false);
            }
        }
    }

    public async Task StoppedTyping(string receiverId, bool isGroup)
    {
        var senderIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(senderIdStr)) return;

        if (isGroup)
        {
            if (Guid.TryParse(receiverId, out var convId))
            {
                if (await _chatService.IsApprovedParticipantAsync(convId, Guid.Parse(senderIdStr)))
                {
                    await Clients.GroupExcept(receiverId, Context.ConnectionId).SendAsync("UserStoppedTyping", senderIdStr, true);
                }
            }
        }
        else
        {
            var receiverConnections = _connectionManager.GetUserConnections(receiverId);
            if (receiverConnections.Any())
            {
                await Clients.Clients(receiverConnections).SendAsync("UserStoppedTyping", senderIdStr, false);
            }
        }
    }
}
