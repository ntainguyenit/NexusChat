namespace NexusChat.Domain.Entities;

public class Friendship
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public Guid FriendId { get; set; }
    public User Friend { get; set; } = null!;

    public bool IsAccepted { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
