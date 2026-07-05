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

    public async Task<IEnumerable<MessageDto>> GetMessagesAsync(Guid conversationId, int skip, int take)
    {
        var messages = await _unitOfWork.Messages.GetMessagesByConversationAsync(conversationId, skip, take);
        
        return messages.Select(m => new MessageDto
        {
            Id = m.Id,
            ConversationId = m.ConversationId,
            SenderId = m.SenderId,
            SenderName = m.Sender.UserName,
            Content = m.Content,
            SentAt = DateTime.SpecifyKind(m.SentAt, DateTimeKind.Utc),
            Status = m.Status
        });
    }

    public async Task<MessageDto> SendMessageAsync(Guid senderId, Guid conversationId, string content)
    {
        var conversation = await _unitOfWork.Conversations.GetByIdAsync(conversationId);
        if (conversation == null)
            throw new Exception("Conversation not found");
            
        var isApproved = await IsApprovedParticipantAsync(conversationId, senderId);
        if (!isApproved)
            throw new Exception("You are not an approved participant of this conversation");

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = senderId,
            Content = content,
            SentAt = DateTime.UtcNow,
            Status = MessageStatus.Sent
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

    public async Task<string?> ApproveJoinRequestAsync(Guid conversationId, Guid requesterId, Guid adminId)
    {
        var admin = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, adminId);
        if (admin == null || !admin.IsAdmin) return null;

        var requester = await _unitOfWork.Conversations.GetParticipantAsync(conversationId, requesterId);
        if (requester == null || requester.Status != ParticipantStatus.Pending) return null;

        requester.Status = ParticipantStatus.Approved;
        _unitOfWork.Conversations.UpdateParticipant(requester);
        await _unitOfWork.SaveChangesAsync();
        return requester.User?.UserName ?? "Unknown";
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
}
