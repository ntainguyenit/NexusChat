using Microsoft.EntityFrameworkCore;
using NexusChat.Application.Interfaces;
using NexusChat.Domain.Entities;
using NexusChat.Infrastructure.Data;

namespace NexusChat.Infrastructure.Repositories;

public class MessageRepository : IMessageRepository
{
    private readonly ApplicationDbContext _context;

    public MessageRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<Message?> GetByIdAsync(Guid id)
    {
        return await _context.Messages
            .Include(m => m.Sender)
            .Include(m => m.Reactions)
            .FirstOrDefaultAsync(m => m.Id == id);
    }

    public async Task<IEnumerable<Message>> GetMessagesByConversationAsync(Guid conversationId, int skip, int take)
    {
        return await _context.Messages
            .Include(m => m.Sender)
            .Include(m => m.Reactions)
                .ThenInclude(r => r.User)
            .Include(m => m.ParentMessage)
                .ThenInclude(p => p.Sender)
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.SentAt)
            .Skip(skip)
            .Take(take)
            .ToListAsync();
    }

    public async Task AddAsync(Message message)
    {
        await _context.Messages.AddAsync(message);
    }

    public void Update(Message message)
    {
        _context.Messages.Update(message);
    }

    public void Delete(Message message)
    {
        _context.Messages.Remove(message);
    }
}

public class ConversationRepository : IConversationRepository
{
    private readonly ApplicationDbContext _context;

    public ConversationRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<Conversation?> GetByIdAsync(Guid id)
    {
        return await _context.Conversations
            .Include(c => c.Participants)
            .ThenInclude(p => p.User)
            .FirstOrDefaultAsync(c => c.Id == id);
    }

    public async Task<Conversation?> GetPrivateConversationAsync(Guid userId1, Guid userId2)
    {
        return await _context.Conversations
            .Where(c => !c.IsGroup && 
                        c.Participants.Any(p => p.UserId == userId1) && 
                        c.Participants.Any(p => p.UserId == userId2))
            .FirstOrDefaultAsync();
    }

    public async Task<IEnumerable<Conversation>> GetConversationsByUserIdAsync(Guid userId)
    {
        return await _context.Conversations
            .Include(c => c.Participants)
            .ThenInclude(p => p.User)
            .Where(c => c.Participants.Any(p => p.UserId == userId && p.Status == NexusChat.Domain.Enums.ParticipantStatus.Approved))
            .ToListAsync();
    }

    public async Task AddAsync(Conversation conversation)
    {
        await _context.Conversations.AddAsync(conversation);
    }

    public async Task<Conversation?> GetByJoinCodeAsync(string joinCode)
    {
        return await _context.Conversations
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.IsGroup && c.JoinCode == joinCode);
    }

    public async Task AddParticipantAsync(ConversationParticipant participant)
    {
        await _context.ConversationParticipants.AddAsync(participant);
    }

    public async Task<bool> HasParticipantAsync(Guid conversationId, Guid userId)
    {
        return await _context.ConversationParticipants
            .AnyAsync(cp => cp.ConversationId == conversationId && cp.UserId == userId);
    }

    public async Task<ConversationParticipant?> GetParticipantAsync(Guid conversationId, Guid userId)
    {
        return await _context.ConversationParticipants
            .Include(cp => cp.User)
            .FirstOrDefaultAsync(cp => cp.ConversationId == conversationId && cp.UserId == userId);
    }

    public async Task<IEnumerable<ConversationParticipant>> GetPendingParticipantsAsync(Guid conversationId)
    {
        return await _context.ConversationParticipants
            .Include(cp => cp.User)
            .Where(cp => cp.ConversationId == conversationId && cp.Status == NexusChat.Domain.Enums.ParticipantStatus.Pending)
            .ToListAsync();
    }

    public async Task<IEnumerable<ConversationParticipant>> GetApprovedParticipantsAsync(Guid conversationId)
    {
        return await _context.ConversationParticipants
            .Include(cp => cp.User)
            .Where(cp => cp.ConversationId == conversationId && cp.Status == NexusChat.Domain.Enums.ParticipantStatus.Approved)
            .OrderBy(cp => cp.JoinedAt)
            .ToListAsync();
    }

    public void UpdateParticipant(ConversationParticipant participant)
    {
        _context.ConversationParticipants.Update(participant);
    }

    public void RemoveParticipant(ConversationParticipant participant)
    {
        _context.ConversationParticipants.Remove(participant);
    }

    public void RemoveConversation(Conversation conversation)
    {
        _context.Conversations.Remove(conversation);
    }

    public void UpdateConversation(Conversation conversation)
    {
        _context.Conversations.Update(conversation);
    }
}

public class UserRepository : IUserRepository
{
    private readonly ApplicationDbContext _context;

    public UserRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<User?> GetByIdAsync(Guid id)
    {
        return await _context.Users.FindAsync(id);
    }

    public async Task<User?> GetByUserNameAsync(string userName)
    {
        return await _context.Users.FirstOrDefaultAsync(u => u.UserName == userName);
    }

    public async Task<User?> GetByEmailAsync(string email)
    {
        return await _context.Users.FirstOrDefaultAsync(u => u.Email == email);
    }

    public void Update(User user)
    {
        _context.Users.Update(user);
    }
}

public class FriendshipRepository : IFriendshipRepository
{
    private readonly ApplicationDbContext _context;

    public FriendshipRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<Friendship?> GetAsync(Guid userId, Guid friendId)
    {
        return await _context.Friendships
            .FirstOrDefaultAsync(f => (f.UserId == userId && f.FriendId == friendId) || 
                                      (f.UserId == friendId && f.FriendId == userId));
    }

    public async Task<IEnumerable<Friendship>> GetFriendsAsync(Guid userId)
    {
        return await _context.Friendships
            .Include(f => f.User)
            .Include(f => f.Friend)
            .Where(f => (f.UserId == userId || f.FriendId == userId) && f.IsAccepted)
            .ToListAsync();
    }

    public async Task<IEnumerable<Friendship>> GetPendingRequestsAsync(Guid userId)
    {
        // incoming requests
        return await _context.Friendships
            .Include(f => f.User)
            .Where(f => f.FriendId == userId && !f.IsAccepted)
            .ToListAsync();
    }

    public async Task AddAsync(Friendship friendship)
    {
        await _context.Friendships.AddAsync(friendship);
    }

    public void Update(Friendship friendship)
    {
        _context.Friendships.Update(friendship);
    }

    public void Delete(Friendship friendship)
    {
        _context.Friendships.Remove(friendship);
    }
}

public class UserBlockRepository : IUserBlockRepository
{
    private readonly ApplicationDbContext _context;

    public UserBlockRepository(ApplicationDbContext context)
    {
        _context = context;
    }

    public async Task<UserBlock?> GetAsync(Guid blockerId, Guid blockedId)
    {
        return await _context.UserBlocks
            .FirstOrDefaultAsync(b => b.BlockerId == blockerId && b.BlockedId == blockedId);
    }

    public async Task<bool> IsBlockedAsync(Guid userId1, Guid userId2)
    {
        return await _context.UserBlocks
            .AnyAsync(b => (b.BlockerId == userId1 && b.BlockedId == userId2) || 
                           (b.BlockerId == userId2 && b.BlockedId == userId1));
    }

    public async Task<IEnumerable<UserBlock>> GetBlockedUsersAsync(Guid blockerId)
    {
        return await _context.UserBlocks
            .Include(b => b.Blocked)
            .Where(b => b.BlockerId == blockerId)
            .ToListAsync();
    }

    public async Task AddAsync(UserBlock block)
    {
        await _context.UserBlocks.AddAsync(block);
    }

    public void Delete(UserBlock block)
    {
        _context.UserBlocks.Remove(block);
    }
}

public class UnitOfWork : IUnitOfWork
{
    private readonly ApplicationDbContext _context;
    
    public IMessageRepository Messages { get; }
    public IConversationRepository Conversations { get; }
    public IUserRepository Users { get; }
    public IFriendshipRepository Friendships { get; }
    public IUserBlockRepository UserBlocks { get; }

    public UnitOfWork(ApplicationDbContext context)
    {
        _context = context;
        Messages = new MessageRepository(context);
        Conversations = new ConversationRepository(context);
        Users = new UserRepository(context);
        Friendships = new FriendshipRepository(context);
        UserBlocks = new UserBlockRepository(context);
    }

    public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return await _context.SaveChangesAsync(cancellationToken);
    }
}
