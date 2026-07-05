using NexusChat.Domain.Entities;

namespace NexusChat.Application.Interfaces;

public interface IMessageRepository
{
    Task<Message?> GetByIdAsync(Guid id);
    Task<IEnumerable<Message>> GetMessagesByConversationAsync(Guid conversationId, int skip, int take);
    Task AddAsync(Message message);
    void Update(Message message);
}

public interface IConversationRepository
{
    Task<Conversation?> GetByIdAsync(Guid id);
    Task<Conversation?> GetPrivateConversationAsync(Guid userId1, Guid userId2);
    Task<IEnumerable<Conversation>> GetConversationsByUserIdAsync(Guid userId);
    Task AddAsync(Conversation conversation);
    Task<Conversation?> GetByJoinCodeAsync(string joinCode);
    Task AddParticipantAsync(ConversationParticipant participant);
    Task<bool> HasParticipantAsync(Guid conversationId, Guid userId);
    Task<ConversationParticipant?> GetParticipantAsync(Guid conversationId, Guid userId);
    Task<IEnumerable<ConversationParticipant>> GetPendingParticipantsAsync(Guid conversationId);
    void UpdateParticipant(ConversationParticipant participant);
    void RemoveConversation(Conversation conversation);
}

public interface IUnitOfWork
{
    IMessageRepository Messages { get; }
    IConversationRepository Conversations { get; }
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
