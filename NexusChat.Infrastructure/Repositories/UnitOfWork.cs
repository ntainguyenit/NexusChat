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
        return await _context.Messages.FindAsync(id);
    }

    public async Task<IEnumerable<Message>> GetMessagesByConversationAsync(Guid conversationId, int skip, int take)
    {
        return await _context.Messages
            .Include(m => m.Sender)
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
            .Where(c => c.Participants.Any(p => p.UserId == userId))
            .ToListAsync();
    }

    public async Task AddAsync(Conversation conversation)
    {
        await _context.Conversations.AddAsync(conversation);
    }
}

public class UnitOfWork : IUnitOfWork
{
    private readonly ApplicationDbContext _context;
    
    public IMessageRepository Messages { get; }
    public IConversationRepository Conversations { get; }

    public UnitOfWork(ApplicationDbContext context)
    {
        _context = context;
        Messages = new MessageRepository(context);
        Conversations = new ConversationRepository(context);
    }

    public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return await _context.SaveChangesAsync(cancellationToken);
    }
}
