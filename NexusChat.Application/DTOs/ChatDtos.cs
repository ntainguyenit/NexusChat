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
    public bool IsEdited { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? EditedAt { get; set; }
    public Guid? ParentMessageId { get; set; }
    public string? ParentMessageContent { get; set; }
    public string? ParentMessageSender { get; set; }
    public bool IsPinned { get; set; }
    public List<MessageReactionDto> Reactions { get; set; } = new List<MessageReactionDto>();
}

public class MessageReactionDto
{
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string ReactionType { get; set; } = string.Empty;
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

public class MemberDto
{
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public bool IsAdmin { get; set; }
    public bool IsOnline { get; set; }
    public DateTime JoinedAt { get; set; }
}

public class UpdateGroupDto
{
    public string Name { get; set; } = string.Empty;
}

public class UpdateProfileDto
{
    public string UserName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}

public class ChangePasswordDto
{
    public string CurrentPassword { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
}

public class FriendDto
{
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public bool IsOnline { get; set; }
    public bool IsPending { get; set; }
    public bool IsIncoming { get; set; } // True nếu mình là người nhận, False nếu mình là người gửi
}

public class BlockedUserDto
{
    public Guid UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
}
