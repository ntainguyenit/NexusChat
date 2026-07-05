using NexusChat.Application.DTOs;
using NexusChat.Application.Interfaces;
using NexusChat.Domain.Entities;
using NexusChat.Domain.Enums;

namespace NexusChat.Application.Services;

public class ChatService : IChatService
{
    private readonly IUnitOfWork _unitOfWork;

    public ChatService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<IEnumerable<MessageDto>> GetMessagesAsync(Guid conversationId, int skip, int take)
    {
        var messages = await _unitOfWork.Messages.GetMessagesByConversationAsync(conversationId, skip, take);
        
        return messages.Select(m => new MessageDto
        {
            Id = m.Id,
            ConversationId = m.ConversationId,
            SenderId = m.SenderId,
            SenderName = m.Sender.UserName,
            Content = m.Content,
            SentAt = m.SentAt,
            Status = m.Status
        });
    }

    public async Task<MessageDto> SendMessageAsync(Guid senderId, Guid conversationId, string content)
    {
        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        if (conversation == null)
            throw new Exception("Conversation not found");

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = senderId,
            Content = content,
            SentAt = DateTime.UtcNow,
            Status = MessageStatus.Sent
        };

        await _unitOfWork.Messages.AddAsync(message);
        await _unitOfWork.SaveChangesAsync();

        // Normally we'd want to load the sender to get the username, or just return the saved message
        // Here we just return a DTO
        return new MessageDto
        {
            Id = message.Id,
            ConversationId = message.ConversationId,
            SenderId = message.SenderId,
            Content = message.Content,
            SentAt = message.SentAt,
            Status = message.Status
        };
    }

    public async Task MarkMessageAsReadAsync(Guid messageId)
    {
        var message = await _unitOfWork.Messages.GetByIdAsync(messageId);
        if (message != null && message.Status != MessageStatus.Read)
        {
            message.Status = MessageStatus.Read;
            _unitOfWork.Messages.Update(message);
            await _unitOfWork.SaveChangesAsync();
        }
    }

    public async Task<Conversation?> GetOrCreatePrivateConversationAsync(Guid userId1, Guid userId2)
    {
        var conversation = await _unitOfWork.Conversations.GetPrivateConversationAsync(userId1, userId2);
        
        if (conversation == null)
        {
            conversation = new Conversation
            {
                IsGroup = false,
                Participants = new List<ConversationParticipant>
                {
                    new ConversationParticipant { UserId = userId1 },
                    new ConversationParticipant { UserId = userId2 }
                }
            };
            
            await _unitOfWork.Conversations.AddAsync(conversation);
            await _unitOfWork.SaveChangesAsync();
        }
        
        return conversation;
    }
}
