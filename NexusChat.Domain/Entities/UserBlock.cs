namespace NexusChat.Domain.Entities;

public class UserBlock
{
    public Guid BlockerId { get; set; }
    public User Blocker { get; set; } = null!;

    public Guid BlockedId { get; set; }
    public User Blocked { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
