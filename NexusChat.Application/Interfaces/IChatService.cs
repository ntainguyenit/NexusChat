using NexusChat.Application.DTOs;
using NexusChat.Domain.Entities;

namespace NexusChat.Application.Interfaces;

public interface IChatService
{
    // Messages
    Task<IEnumerable<MessageDto>> GetMessagesAsync(Guid conversationId, int skip, int take);
    Task<MessageDto> SendMessageAsync(Guid senderId, Guid conversationId, string content, Guid? parentMessageId = null);
    Task<MessageDto?> MarkMessageAsReadAsync(Guid messageId);
    Task<MessageDto?> EditMessageAsync(Guid messageId, Guid userId, string newContent);
    Task<MessageDto?> DeleteMessageAsync(Guid messageId, Guid userId);
    Task<bool> PinMessageAsync(Guid messageId, Guid userId, bool isPinned);
    Task<MessageReactionDto?> ToggleReactionAsync(Guid messageId, Guid userId, string reactionType);

    // Conversations
    Task<Conversation?> GetOrCreatePrivateConversationAsync(Guid userId1, Guid userId2);
    Task<Conversation> CreateGroupConversationAsync(string name, Guid creatorId, List<Guid> participantIds);
    Task<Conversation?> JoinGroupAsync(Guid userId, string joinCode);
    Task<IEnumerable<ConversationDto>> GetConversationsAsync(Guid userId);
    Task<bool> IsApprovedParticipantAsync(Guid conversationId, Guid userId);

    // Group Approval
    Task<(string? UserName, string? GroupName)> ApproveJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId);
    Task<bool> RejectJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId);
    Task<IEnumerable<JoinRequestDto>> GetPendingRequestsAsync(Guid adminId);
    Task<bool> DisbandGroupAsync(Guid conversationId, Guid adminId);

    // Group Management
    Task<IEnumerable<MemberDto>> GetGroupMembersAsync(Guid conversationId, Guid userId);
    Task<(bool Success, string? UserName)> LeaveGroupAsync(Guid conversationId, Guid userId);
    Task<(bool Success, string? UserName)> KickMemberAsync(Guid conversationId, Guid memberId, Guid adminId);
    Task<bool> RenameGroupAsync(Guid conversationId, Guid adminId, string newName);

    // Friends
    Task<(bool, Guid?)> SendFriendRequestAsync(Guid userId, string friendEmail);
    Task<bool> AcceptFriendRequestAsync(Guid userId, Guid friendId);
    Task<bool> RejectFriendRequestAsync(Guid userId, Guid friendId);
    Task<bool> RemoveFriendAsync(Guid userId, Guid friendId);
    Task<IEnumerable<FriendDto>> GetFriendsListAsync(Guid userId);
    Task<IEnumerable<FriendDto>> GetPendingFriendRequestsAsync(Guid userId);

    // Blocks
    Task<bool> BlockUserAsync(Guid blockerId, Guid blockedId);
    Task<bool> UnblockUserAsync(Guid blockerId, Guid blockedId);
    Task<IEnumerable<BlockedUserDto>> GetBlockedUsersAsync(Guid blockerId);
    Task<bool> IsBlockedAsync(Guid userId1, Guid userId2);
}
