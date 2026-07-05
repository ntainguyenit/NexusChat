namespace NexusChat.Domain.Entities;

public class Conversation : BaseEntity
{
    public bool IsGroup { get; set; }
    public string? GroupName { get; set; }

    // Navigation properties
    public ICollection<ConversationParticipant> Participants { get; set; } = new List<ConversationParticipant>();
    public ICollection<Message> Messages { get; set; } = new List<Message>();
}