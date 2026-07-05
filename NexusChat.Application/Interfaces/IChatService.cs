using NexusChat.Application.DTOs;
using NexusChat.Domain.Entities;

namespace NexusChat.Application.Interfaces;

public interface IChatService
{
    Task<IEnumerable<MessageDto>> GetMessagesAsync(Guid conversationId, int skip, int take);
    Task<MessageDto> SendMessageAsync(Guid senderId, Guid conversationId, string content);
    Task MarkMessageAsReadAsync(Guid messageId);
    Task<Conversation?> GetOrCreatePrivateConversationAsync(Guid userId1, Guid userId2);
    Task<Conversation> CreateGroupConversationAsync(string name, List<Guid> participantIds);
}
