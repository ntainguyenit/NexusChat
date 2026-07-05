using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using NexusChat.Application.Interfaces;

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

    public async Task SendMessageToUser(string receiverId, string content)
    {
        var senderIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(senderIdStr) || !Guid.TryParse(senderIdStr, out var senderId))
            return;

        if (!Guid.TryParse(receiverId, out var receiverGuid))
            return;

        // Ensure a private conversation exists between the two users
        var conversation = await _chatService.GetOrCreatePrivateConversationAsync(senderId, receiverGuid);
        if (conversation == null) return;

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
    }

    public async Task SendMessageToGroup(Guid conversationId, string content)
    {
        var senderIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(senderIdStr) || !Guid.TryParse(senderIdStr, out var senderId))
            return;

        // Save message to DB
        var messageDto = await _chatService.SendMessageAsync(senderId, conversationId, content);

        // Broadcast to group
        await Clients.Group(conversationId.ToString()).SendAsync("ReceiveMessage", messageDto);
    }

    public async Task JoinGroup(Guid conversationId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, conversationId.ToString());
    }

    public async Task LeaveGroup(Guid conversationId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, conversationId.ToString());
    }

    public async Task MarkAsRead(Guid messageId)
    {
        await _chatService.MarkMessageAsReadAsync(messageId);
        // Optionally notify sender that message was read
        // e.g., await Clients.User(senderId).SendAsync("MessageRead", messageId);
    }
}
