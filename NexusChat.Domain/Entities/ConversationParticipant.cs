namespace NexusChat.Domain.Entities;

public class ConversationParticipant
{
    public Guid ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public bool IsAdmin { get; set; } = false;
    public NexusChat.Domain.Enums.ParticipantStatus Status { get; set; } = NexusChat.Domain.Enums.ParticipantStatus.Approved;

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
}