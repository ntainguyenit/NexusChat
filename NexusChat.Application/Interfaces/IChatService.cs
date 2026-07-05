using NexusChat.Application.DTOs;
using NexusChat.Domain.Entities;

namespace NexusChat.Application.Interfaces;

public interface IChatService
{
    Task<IEnumerable<MessageDto>> GetMessagesAsync(Guid conversationId, int skip, int take);
    Task<MessageDto> SendMessageAsync(Guid senderId, Guid conversationId, string content);
    Task<MessageDto?> MarkMessageAsReadAsync(Guid messageId);
    Task<Conversation?> GetOrCreatePrivateConversationAsync(Guid userId1, Guid userId2);
    Task<Conversation> CreateGroupConversationAsync(string name, Guid creatorId, List<Guid> participantIds);
    Task<Conversation?> JoinGroupAsync(Guid userId, string joinCode);
    Task<IEnumerable<ConversationDto>> GetConversationsAsync(Guid userId);
    Task<bool> IsApprovedParticipantAsync(Guid conversationId, Guid userId);
    Task<string?> ApproveJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId);
    Task<bool> RejectJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId);
    Task<IEnumerable<JoinRequestDto>> GetPendingRequestsAsync(Guid adminId);
    Task<bool> DisbandGroupAsync(Guid conversationId, Guid adminId);
}
