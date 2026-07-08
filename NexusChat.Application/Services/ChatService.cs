using NexusChat.Application.DTOs;
using NexusChat.Application.Interfaces;
using NexusChat.Domain.Entities;
using NexusChat.Domain.Enums;

namespace NexusChat.Application.Services;

public class ChatService : IChatService
{
    private readonly IUnitOfWork _unitOfWork;

    public ChatService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    private MessageDto ToMessageDto(Message m) => new MessageDto
    {
        Id = m.Id,
        ConversationId = m.ConversationId,
        SenderId = m.SenderId,
        SenderName = m.Sender?.UserName ?? string.Empty,
        Content = m.IsDeleted ? "" : m.Content,
        SentAt = DateTime.SpecifyKind(m.SentAt, DateTimeKind.Utc),
        Status = m.Status,
        IsEdited = m.IsEdited,
        IsDeleted = m.IsDeleted,
        EditedAt = m.EditedAt.HasValue ? DateTime.SpecifyKind(m.EditedAt.Value, DateTimeKind.Utc) : null,
        ParentMessageId = m.ParentMessageId,
        ParentMessageContent = m.ParentMessage?.IsDeleted == false ? m.ParentMessage.Content : (m.ParentMessage?.IsDeleted == true ? "Tin nhắn đã bị xóa" : null),
        ParentMessageSender = m.ParentMessage?.Sender?.UserName,
        IsPinned = m.IsPinned,
        Reactions = m.Reactions?.Select(r => new MessageReactionDto 
        {
            UserId = r.UserId,
            UserName = r.User?.UserName ?? "Unknown",
            ReactionType = r.ReactionType
        }).ToList() ?? new List<MessageReactionDto>()
    };

    public async Task<IEnumerable<MessageDto>> GetMessagesAsync(Guid conversationId, int skip, int take)
    {
        var messages = await _unitOfWork.Messages.GetMessagesByConversationAsync(conversationId, skip, take);
        return messages.Select(ToMessageDto);
    }

    public async Task<MessageDto> SendMessageAsync(Guid senderId, Guid conversationId, string content, Guid? parentMessageId = null)
    {
        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        if (conversation == null)
            throw new Exception("Conversation not found");
            
        var isApproved = await IsApprovedParticipantAsync(conversationId, senderId);
        if (!isApproved)
            throw new Exception("You are not an approved participant of this conversation");

        // Check blocking in private conversations
        if (!conversation.IsGroup)
        {
            var otherParticipant = conversation.Participants.FirstOrDefault(p => p.UserId != senderId);
            if (otherParticipant != null)
            {
                var isBlocked = await _unitOfWork.UserBlocks.IsBlockedAsync(senderId, otherParticipant.UserId);
                if (isBlocked)
                    throw new Exception("Cannot send message. User is blocked or you are blocked.");
            }
        }

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = senderId,
            Content = content,
            SentAt = DateTime.UtcNow,
            Status = MessageStatus.Sent,
            ParentMessageId = parentMessageId
        };

        await _unitOfWork.Messages.AddAsync(message);
        await _unitOfWork.SaveChangesAsync();

        return new MessageDto
        {
            Id = message.Id,
            ConversationId = message.ConversationId,
            SenderId = message.SenderId,
            Content = message.Content,
            SentAt = DateTime.SpecifyKind(message.SentAt, DateTimeKind.Utc),
            Status = message.Status
        };
    }

    public async Task<MessageDto?> MarkMessageAsReadAsync(Guid messageId)
    {
        var message = await _unitOfWork.Messages.GetByIdAsync(messageId);
        if (message != null && message.Status != MessageStatus.Read)
        {
            message.Status = MessageStatus.Read;
            _unitOfWork.Messages.Update(message);
            await _unitOfWork.SaveChangesAsync();
            
            return new MessageDto
            {
                Id = message.Id,
                ConversationId = message.ConversationId,
                SenderId = message.SenderId,
                Content = message.Content,
                SentAt = DateTime.SpecifyKind(message.SentAt, DateTimeKind.Utc),
                Status = message.Status
            };
        }
        return null;
    }

    public async Task<MessageDto?> EditMessageAsync(Guid messageId, Guid userId, string newContent)
    {
        var message = await _unitOfWork.Messages.GetByIdAsync(messageId);
        if (message == null || message.SenderId != userId || message.IsDeleted) return null;

        message.Content = newContent;
        message.IsEdited = true;
        message.EditedAt = DateTime.UtcNow;
        _unitOfWork.Messages.Update(message);
        await _unitOfWork.SaveChangesAsync();

        return ToMessageDto(message);
    }

    public async Task<MessageDto?> DeleteMessageAsync(Guid messageId, Guid userId)
    {
        var message = await _unitOfWork.Messages.GetByIdAsync(messageId);
        if (message == null || message.IsDeleted) return null;

        // Allow sender or group admin to delete
        if (message.SenderId != userId)
        {
            var conversation = await _unitOfWork.Conversations.GetByIdAsync(message.ConversationId);
            if (conversation == null || !conversation.IsGroup) return null;
            var admin = conversation.Participants.FirstOrDefault(p => p.UserId == userId);
            if (admin == null || !admin.IsAdmin) return null;
        }

        message.IsDeleted = true;
        message.Content = "";
        _unitOfWork.Messages.Update(message);
        await _unitOfWork.SaveChangesAsync();

        return ToMessageDto(message);
    }

    public async Task<Conversation?> GetOrCreatePrivateConversationAsync(Guid userId1, Guid userId2)
    {
        var conversation = await _unitOfWork.Conversations.GetPrivateConversationAsync(userId1, userId2);
        
        if (conversation == null)
        {
            conversation = new Conversation
            {
                IsGroup = false,
                Participants = new List<ConversationParticipant>
                {
                    new ConversationParticipant { UserId = userId1, Status = ParticipantStatus.Approved },
                    new ConversationParticipant { UserId = userId2, Status = ParticipantStatus.Approved }
                }
            };
            
            await _unitOfWork.Conversations.AddAsync(conversation);
            await _unitOfWork.SaveChangesAsync();
        }
        
        return conversation;
    }

    public async Task<Conversation> CreateGroupConversationAsync(string name, Guid creatorId, List<Guid> participantIds)
    {
        // Generate random 6-character code
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        var joinCode = new string(Enumerable.Repeat(chars, 6)
            .Select(s => s[new Random().Next(s.Length)]).ToArray());

        var conversation = new Conversation
        {
            IsGroup = true,
            GroupName = name,
            JoinCode = joinCode,
            Participants = participantIds.Select(id => new ConversationParticipant 
            { 
                UserId = id,
                Status = ParticipantStatus.Approved,
                IsAdmin = id == creatorId
            }).ToList()
        };
        
        await _unitOfWork.Conversations.AddAsync(conversation);
        await _unitOfWork.SaveChangesAsync();
        
        return conversation;
    }

    public async Task<Conversation?> JoinGroupAsync(Guid userId, string joinCode)
    {
        var conversation = await _unitOfWork.Conversations.GetByJoinCodeAsync(joinCode);
        if (conversation == null) return null;

        var participant = await _unitOfWork.Conversations.GetParticipantAsync(conversation.Id, userId);

        if (participant == null)
        {
            await _unitOfWork.Conversations.AddParticipantAsync(new ConversationParticipant
            {
                ConversationId = conversation.Id,
                UserId = userId,
                JoinedAt = DateTime.UtcNow,
                Status = ParticipantStatus.Pending,
                IsAdmin = false
            });
            await _unitOfWork.SaveChangesAsync();
        }

        return conversation;
    }

    public async Task<IEnumerable<ConversationDto>> GetConversationsAsync(Guid userId)
    {
        var conversations = await _unitOfWork.Conversations.GetConversationsByUserIdAsync(userId);
        return conversations.Select(c => 
        {
            var myParticipant = c.Participants.FirstOrDefault(p => p.UserId == userId);
            return new ConversationDto
            {
                Id = c.Id,
                IsGroup = c.IsGroup,
                Name = c.IsGroup 
                    ? (c.GroupName ?? string.Empty) 
                    : c.Participants.FirstOrDefault(p => p.UserId != userId)?.User?.UserName ?? "Unknown",
                JoinCode = c.JoinCode,
                IsAdmin = myParticipant?.IsAdmin ?? false,
                IsPending = myParticipant?.Status == ParticipantStatus.Pending
            };
        });
    }

    public async Task<bool> IsApprovedParticipantAsync(Guid conversationId, Guid userId)
    {
        var participant = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, userId);
        return participant != null && participant.Status == ParticipantStatus.Approved;
    }

    public async Task<(string? UserName, string? GroupName)> ApproveJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId)
    {
        var admin = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, adminId);
        if (admin == null || !admin.IsAdmin) return (null, null);

        var requester = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, requesterId);
        if (requester == null || requester.Status != ParticipantStatus.Pending) return (null, null);

        requester.Status = ParticipantStatus.Approved;
        _unitOfWork.Conversations.UpdateParticipant(requester);
        await _unitOfWork.SaveChangesAsync();

        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        return (requester.User?.UserName ?? "Unknown", conversation?.GroupName ?? "Unknown Group");
    }

    public async Task<bool> RejectJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId)
    {
        var admin = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, adminId);
        if (admin == null || !admin.IsAdmin) return false;

        var requester = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, requesterId);
        if (requester == null || requester.Status != ParticipantStatus.Pending) return false;

        requester.Status = ParticipantStatus.Rejected;
        _unitOfWork.Conversations.UpdateParticipant(requester);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<JoinRequestDto>> GetPendingRequestsAsync(Guid adminId)
    {
        var requests = new List<JoinRequestDto>();
        var adminConversations = await _unitOfWork.Conversations.GetConversationsByUserIdAsync(adminId);
        
        foreach (var conv in adminConversations.Where(c => c.IsGroup))
        {
            var admin = conv.Participants.FirstOrDefault(p => p.UserId == adminId);
            if (admin != null && admin.IsAdmin)
            {
                var pending = await _unitOfWork.Conversations.GetPendingParticipantsAsync(conv.Id);
                foreach (var p in pending)
                {
                    requests.Add(new JoinRequestDto
                    {
                        ConversationId = conv.Id,
                        GroupName = conv.GroupName ?? "Unknown Group",
                        RequesterId = p.UserId,
                        RequesterName = p.User.UserName
                    });
                }
            }
        }
        return requests;
    }

    public async Task<bool> DisbandGroupAsync(Guid conversationId, Guid adminId)
    {
        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        if (conversation == null || !conversation.IsGroup) return false;

        var admin = conversation.Participants.FirstOrDefault(p => p.UserId == adminId);
        if (admin == null || !admin.IsAdmin) return false;

        _unitOfWork.Conversations.RemoveConversation(conversation);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    // --- Group Management ---

    public async Task<IEnumerable<MemberDto>> GetGroupMembersAsync(Guid conversationId, Guid userId)
    {
        var isApproved = await IsApprovedParticipantAsync(conversationId, userId);
        if (!isApproved) return Enumerable.Empty<MemberDto>();

        var participants = await _unitOfWork.Conversations.GetApprovedParticipantsAsync(conversationId);
        return participants.Select(p => new MemberDto
        {
            UserId = p.UserId,
            UserName = p.User?.UserName ?? "Unknown",
            IsAdmin = p.IsAdmin,
            JoinedAt = p.JoinedAt
        });
    }

    public async Task<(bool Success, string? UserName)> LeaveGroupAsync(Guid conversationId, Guid userId)
    {
        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        if (conversation == null || !conversation.IsGroup) return (false, null);

        var participant = conversation.Participants.FirstOrDefault(p => p.UserId == userId);
        if (participant == null || participant.Status != ParticipantStatus.Approved) return (false, null);

        var userName = participant.User?.UserName ?? "Unknown";

        // If admin leaves, transfer admin to earliest joined member
        if (participant.IsAdmin)
        {
            var nextAdmin = conversation.Participants
                .Where(p => p.UserId != userId && p.Status == ParticipantStatus.Approved)
                .OrderBy(p => p.JoinedAt)
                .FirstOrDefault();
            
            if (nextAdmin != null)
            {
                nextAdmin.IsAdmin = true;
                _unitOfWork.Conversations.UpdateParticipant(nextAdmin);
            }
            else
            {
                // Last member leaving — disband group
                _unitOfWork.Conversations.RemoveConversation(conversation);
                await _unitOfWork.SaveChangesAsync();
                return (true, userName);
            }
        }

        _unitOfWork.Conversations.RemoveParticipant(participant);
        await _unitOfWork.SaveChangesAsync();
        return (true, userName);
    }

    public async Task<(bool Success, string? UserName)> KickMemberAsync(Guid conversationId, Guid memberId, Guid adminId)
    {
        var admin = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, adminId);
        if (admin == null || !admin.IsAdmin) return (false, null);

        var member = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, memberId);
        if (member == null || member.Status != ParticipantStatus.Approved) return (false, null);
        if (member.IsAdmin) return (false, null); // Cannot kick another admin

        var userName = member.User?.UserName ?? "Unknown";
        _unitOfWork.Conversations.RemoveParticipant(member);
        await _unitOfWork.SaveChangesAsync();
        return (true, userName);
    }

    public async Task<bool> RenameGroupAsync(Guid conversationId, Guid adminId, string newName)
    {
        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        if (conversation == null || !conversation.IsGroup) return false;

        var admin = conversation.Participants.FirstOrDefault(p => p.UserId == adminId);
        if (admin == null || !admin.IsAdmin) return false;

        conversation.GroupName = newName;
        _unitOfWork.Conversations.UpdateConversation(conversation);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<bool> PinMessageAsync(Guid messageId, Guid userId, bool isPinned)
    {
        var message = await _unitOfWork.Messages.GetByIdAsync(messageId);
        if (message == null) return false;

        var isApproved = await IsApprovedParticipantAsync(message.ConversationId, userId);
        if (!isApproved) return false;

        message.IsPinned = isPinned;
        _unitOfWork.Messages.Update(message);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<MessageReactionDto?> ToggleReactionAsync(Guid messageId, Guid userId, string reactionType)
    {
        var message = await _unitOfWork.Messages.GetByIdAsync(messageId);
        if (message == null) return null;

        var isApproved = await IsApprovedParticipantAsync(message.ConversationId, userId);
        if (!isApproved) return null;

        var user = await _unitOfWork.Users.GetByIdAsync(userId);
        if (user == null) return null;

        var existingReaction = message.Reactions.FirstOrDefault(r => r.UserId == userId);
        if (existingReaction != null)
        {
            if (existingReaction.ReactionType == reactionType)
            {
                // Toggle off
                message.Reactions.Remove(existingReaction);
                await _unitOfWork.SaveChangesAsync();
                return new MessageReactionDto { UserId = userId, UserName = user.UserName, ReactionType = "" };
            }
            else
            {
                // Change reaction
                existingReaction.ReactionType = reactionType;
            }
        }
        else
        {
            // Add new reaction
            var newReaction = new MessageReaction
            {
                MessageId = messageId,
                UserId = userId,
                ReactionType = reactionType
            };
            message.Reactions.Add(newReaction);
        }

        await _unitOfWork.SaveChangesAsync();

        return new MessageReactionDto
        {
            UserId = userId,
            UserName = user.UserName,
            ReactionType = reactionType
        };
    }

    // --- Friends Management ---

    public async Task<bool> SendFriendRequestAsync(Guid userId, string friendUserName)
    {
        var friend = await _unitOfWork.Users.GetByUserNameAsync(friendUserName);
        if (friend == null || friend.Id == userId) return false;

        var existing = await _unitOfWork.Friendships.GetAsync(userId, friend.Id);
        if (existing != null) return false;

        await _unitOfWork.Friendships.AddAsync(new Friendship
        {
            UserId = userId,
            FriendId = friend.Id,
            IsAccepted = false
        });
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<bool> AcceptFriendRequestAsync(Guid userId, Guid friendId)
    {
        var friendship = await _unitOfWork.Friendships.GetAsync(userId, friendId);
        // Only the receiver can accept
        if (friendship == null || friendship.IsAccepted || friendship.FriendId != userId) return false;

        friendship.IsAccepted = true;
        _unitOfWork.Friendships.Update(friendship);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<bool> RejectFriendRequestAsync(Guid userId, Guid friendId)
    {
        var friendship = await _unitOfWork.Friendships.GetAsync(userId, friendId);
        if (friendship == null || friendship.IsAccepted || friendship.FriendId != userId) return false;

        _unitOfWork.Friendships.Delete(friendship);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<bool> RemoveFriendAsync(Guid userId, Guid friendId)
    {
        var friendship = await _unitOfWork.Friendships.GetAsync(userId, friendId);
        if (friendship == null || !friendship.IsAccepted) return false;

        _unitOfWork.Friendships.Delete(friendship);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<FriendDto>> GetFriendsListAsync(Guid userId)
    {
        var friends = await _unitOfWork.Friendships.GetFriendsAsync(userId);
        return friends.Select(f => 
        {
            var isUser1 = f.UserId == userId;
            var friendUser = isUser1 ? f.Friend : f.User;
            return new FriendDto
            {
                UserId = friendUser.Id,
                UserName = friendUser.UserName,
                IsOnline = false, // Will be updated by signalr or another layer
                IsPending = false,
                IsIncoming = false
            };
        });
    }

    public async Task<IEnumerable<FriendDto>> GetPendingFriendRequestsAsync(Guid userId)
    {
        var pending = await _unitOfWork.Friendships.GetPendingRequestsAsync(userId);
        return pending.Select(f => new FriendDto
        {
            UserId = f.User.Id,
            UserName = f.User.UserName,
            IsOnline = false,
            IsPending = true,
            IsIncoming = true
        });
    }

    // --- Blocks Management ---

    public async Task<bool> BlockUserAsync(Guid blockerId, Guid blockedId)
    {
        if (blockerId == blockedId) return false;
        var existing = await _unitOfWork.UserBlocks.GetAsync(blockerId, blockedId);
        if (existing != null) return true; // already blocked

        // Remove friendship if exists
        var friendship = await _unitOfWork.Friendships.GetAsync(blockerId, blockedId);
        if (friendship != null)
        {
            _unitOfWork.Friendships.Delete(friendship);
        }

        await _unitOfWork.UserBlocks.AddAsync(new UserBlock { BlockerId = blockerId, BlockedId = blockedId });
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UnblockUserAsync(Guid blockerId, Guid blockedId)
    {
        var existing = await _unitOfWork.UserBlocks.GetAsync(blockerId, blockedId);
        if (existing == null) return false;

        _unitOfWork.UserBlocks.Delete(existing);
        await _unitOfWork.SaveChangesAsync();
        return true;
    }

    public async Task<IEnumerable<BlockedUserDto>> GetBlockedUsersAsync(Guid blockerId)
    {
        var blocks = await _unitOfWork.UserBlocks.GetBlockedUsersAsync(blockerId);
        return blocks.Select(b => new BlockedUserDto
        {
            UserId = b.BlockedId,
            UserName = b.Blocked.UserName
        });
    }

    public async Task<bool> IsBlockedAsync(Guid userId1, Guid userId2)
    {
        return await _unitOfWork.UserBlocks.IsBlockedAsync(userId1, userId2);
    }
}
