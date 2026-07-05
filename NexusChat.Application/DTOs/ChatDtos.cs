using NexusChat.Domain.Entities;
using NexusChat.Domain.Enums;

namespace NexusChat.Application.DTOs;

public class MessageDto
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid SenderId { get; set; }
    public string SenderName { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime SentAt { get; set; }
    public MessageStatus Status { get; set; }
}

public class JoinRequestDto
{
    public Guid ConversationId { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public Guid RequesterId { get; set; }
    public string RequesterName { get; set; } = string.Empty;
}

public class CreateGroupDto
{
    public string Name { get; set; } = string.Empty;
    public List<Guid> ParticipantIds { get; set; } = new List<Guid>();
}

public class ConversationDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsGroup { get; set; }
    public string? JoinCode { get; set; }
    public bool IsAdmin { get; set; }
    public bool IsPending { get; set; }
}
