namespace NexusChat.Domain.Entities;

public class MessageReaction : BaseEntity
{
    public Guid MessageId { get; set; }
    public Message Message { get; set; } = null!;

    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public string ReactionType { get; set; } = string.Empty; // "like", "love", "haha", "wow", "sad", "angry"
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
