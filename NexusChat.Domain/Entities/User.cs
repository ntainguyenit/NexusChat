namespace NexusChat.Domain.Entities;

public class User : BaseEntity
{
    public string UserName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public DateTime? LastActiveAt { get; set; }
    public string? Bio { get; set; }

    // Navigation properties
    public ICollection<ConversationParticipant> ConversationParticipants { get; set; } = new List<ConversationParticipant>();
    public ICollection<Message> SentMessages { get; set; } = new List<Message>();
    
    public ICollection<Friendship> FriendshipsInitiated { get; set; } = new List<Friendship>();
    public ICollection<Friendship> FriendshipsReceived { get; set; } = new List<Friendship>();

    public ICollection<UserBlock> BlocksInitiated { get; set; } = new List<UserBlock>();
    public ICollection<UserBlock> BlocksReceived { get; set; } = new List<UserBlock>();

    public ICollection<MessageReaction> Reactions { get; set; } = new List<MessageReaction>();
}