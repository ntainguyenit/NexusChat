using NexusChat.Domain.Entities;

namespace NexusChat.Application.Interfaces;

public interface IMessageRepository
{
    Task<Message?> GetByIdAsync(Guid id);
    Task<IEnumerable<Message>> GetMessagesByConversationAsync(Guid conversationId, int skip, int take);
    Task AddAsync(Message message);
    void Update(Message message);
    void Delete(Message message);
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
    Task<IEnumerable<ConversationParticipant>> GetApprovedParticipantsAsync(Guid conversationId);
    void UpdateParticipant(ConversationParticipant participant);
    void RemoveParticipant(ConversationParticipant participant);
    void RemoveConversation(Conversation conversation);
    void UpdateConversation(Conversation conversation);
}

public interface IUserRepository
{
    Task<User?> GetByIdAsync(Guid id);
    Task<User?> GetByUserNameAsync(string userName);
    Task<User?> GetByEmailAsync(string email);
    void Update(User user);
}

public interface IFriendshipRepository
{
    Task<Friendship?> GetAsync(Guid userId, Guid friendId);
    Task<IEnumerable<Friendship>> GetFriendsAsync(Guid userId);
    Task<IEnumerable<Friendship>> GetPendingRequestsAsync(Guid userId); // incoming
    Task AddAsync(Friendship friendship);
    void Update(Friendship friendship);
    void Delete(Friendship friendship);
}

public interface IUserBlockRepository
{
    Task<UserBlock?> GetAsync(Guid blockerId, Guid blockedId);
    Task<bool> IsBlockedAsync(Guid userId1, Guid userId2); // check cả 2 chiều
    Task<IEnumerable<UserBlock>> GetBlockedUsersAsync(Guid blockerId);
    Task AddAsync(UserBlock block);
    void Delete(UserBlock block);
}

public interface IUnitOfWork
{
    IMessageRepository Messages { get; }
    IConversationRepository Conversations { get; }
    IUserRepository Users { get; }
    IFriendshipRepository Friendships { get; }
    IUserBlockRepository UserBlocks { get; }
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
