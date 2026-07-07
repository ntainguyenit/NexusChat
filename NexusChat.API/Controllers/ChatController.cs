using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusChat.Application.DTOs;
using NexusChat.Application.Interfaces;

using Microsoft.AspNetCore.SignalR;
using NexusChat.API.Hubs;
using NexusChat.Infrastructure.SignalR;

namespace NexusChat.API.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class ChatController : ControllerBase
{
    private readonly IChatService _chatService;
    private readonly IHubContext<ChatHub> _hubContext;
    private readonly IUserConnectionManager _connectionManager;

    public ChatController(IChatService chatService, IHubContext<ChatHub> hubContext, IUserConnectionManager connectionManager)
    {
        _chatService = chatService;
        _hubContext = hubContext;
        _connectionManager = connectionManager;
    }

    private Guid? GetCurrentUserId()
    {
        var str = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(str) || !Guid.TryParse(str, out var id)) return null;
        return id;
    }

    [HttpGet("messages/{conversationId}")]
    public async Task<ActionResult<IEnumerable<MessageDto>>> GetMessages(Guid conversationId, [FromQuery] int skip = 0, [FromQuery] int take = 20)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();
            
        var isApproved = await _chatService.IsApprovedParticipantAsync(conversationId, userId.Value);
        if (!isApproved) return Forbid();

        var messages = await _chatService.GetMessagesAsync(conversationId, skip, take);
        return Ok(messages);
    }

    [HttpGet("private/{otherUserId}")]
    public async Task<ActionResult<ConversationDto>> GetPrivateConversation(Guid otherUserId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();
            
        var conversation = await _chatService.GetOrCreatePrivateConversationAsync(userId.Value, otherUserId);
        if (conversation == null) return NotFound();
        
        return Ok(new ConversationDto 
        { 
            Id = conversation.Id, 
            IsGroup = conversation.IsGroup,
            Name = conversation.GroupName ?? string.Empty
        });
    }

    [HttpPost("group")]
    public async Task<ActionResult<ConversationDto>> CreateGroup([FromBody] CreateGroupDto dto)
    {
        try 
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();
                
            if (dto.ParticipantIds == null)
                dto.ParticipantIds = new List<Guid>();

            dto.ParticipantIds.Add(userId.Value);
            var distinctIds = dto.ParticipantIds.Distinct().ToList();
            
            var conversation = await _chatService.CreateGroupConversationAsync(dto.Name, userId.Value, distinctIds);
            
            return Ok(new ConversationDto 
            { 
                Id = conversation.Id, 
                IsGroup = conversation.IsGroup,
                Name = conversation.GroupName ?? string.Empty,
                JoinCode = conversation.JoinCode,
                IsAdmin = true
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, ex.ToString());
        }
    }

    public class JoinGroupDto
    {
        public string Code { get; set; } = string.Empty;
    }

    [HttpPost("group/join")]
    public async Task<ActionResult<ConversationDto>> JoinGroup([FromBody] JoinGroupDto dto)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();
            
        var conversation = await _chatService.JoinGroupAsync(userId.Value, dto.Code);
        if (conversation == null) return BadRequest("Invalid group code or group does not exist.");
        
        // Notify admin via SignalR
        var isApproved = await _chatService.IsApprovedParticipantAsync(conversation.Id, userId.Value);

        // Only send request notification if they are genuinely pending
        if (!isApproved)
        {
            var adminConnections = _connectionManager.GetUserConnections(conversation.Participants.FirstOrDefault(p => p.IsAdmin)?.UserId.ToString() ?? "");
            if (adminConnections.Any())
            {
                var requestDto = new JoinRequestDto
                {
                    ConversationId = conversation.Id,
                    GroupName = conversation.GroupName ?? "Unknown Group",
                    RequesterId = userId.Value,
                    RequesterName = User.Identity?.Name ?? "A user"
                };
                await _hubContext.Clients.Clients(adminConnections).SendAsync("JoinRequestReceived", requestDto);
            }
        }

        return Ok(new ConversationDto 
        { 
            Id = conversation.Id, 
            IsGroup = conversation.IsGroup,
            Name = conversation.GroupName ?? string.Empty,
            JoinCode = conversation.JoinCode,
            IsPending = !isApproved
        });
    }

    [HttpGet("group/requests")]
    public async Task<ActionResult<IEnumerable<JoinRequestDto>>> GetPendingRequests()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var requests = await _chatService.GetPendingRequestsAsync(userId.Value);
        return Ok(requests);
    }

    public class ReviewRequestDto
    {
        public Guid ConversationId { get; set; }
        public Guid RequesterId { get; set; }
    }

    [HttpPost("group/approve")]
    public async Task<IActionResult> ApproveRequest([FromBody] ReviewRequestDto dto)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var result = await _chatService.ApproveJoinRequestAsync(dto.ConversationId, dto.RequesterId, userId.Value);
        if (result.UserName == null) return BadRequest("Unable to approve request.");

        // Notify user via SignalR
        var userConnections = _connectionManager.GetUserConnections(dto.RequesterId.ToString());
        if (userConnections.Any())
        {
            await _hubContext.Clients.Clients(userConnections).SendAsync("JoinRequestApproved", new { conversationId = dto.ConversationId, groupName = result.GroupName });
        }

        // Send System Message to Group
        var sysMsgContent = $"[SYSTEM] {result.UserName} vừa tham gia nhóm.";
        var sysMsgDto = await _chatService.SendMessageAsync(userId.Value, dto.ConversationId, sysMsgContent);
        await _hubContext.Clients.Group(dto.ConversationId.ToString()).SendAsync("ReceiveMessage", sysMsgDto);

        return Ok();
    }

    [HttpPost("group/reject")]
    public async Task<IActionResult> RejectRequest([FromBody] ReviewRequestDto dto)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var success = await _chatService.RejectJoinRequestAsync(dto.ConversationId, dto.RequesterId, userId.Value);
        if (!success) return BadRequest("Unable to reject request.");

        // Notify user via SignalR
        var userConnections = _connectionManager.GetUserConnections(dto.RequesterId.ToString());
        if (userConnections.Any())
        {
            await _hubContext.Clients.Clients(userConnections).SendAsync("JoinRequestRejected", dto.ConversationId);
        }

        return Ok();
    }

    [HttpDelete("group/{conversationId}")]
    public async Task<IActionResult> DisbandGroup(Guid conversationId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var success = await _chatService.DisbandGroupAsync(conversationId, userId.Value);
        if (!success) return BadRequest("Unable to disband group.");

        // Notify group members
        await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("GroupDisbanded", conversationId);

        return Ok();
    }

    [HttpGet("conversations")]
    public async Task<ActionResult<IEnumerable<ConversationDto>>> GetConversations()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();
            
        var conversations = await _chatService.GetConversationsAsync(userId.Value);
        return Ok(conversations);
    }

    // --- Group Member Management ---

    [HttpGet("group/{conversationId}/members")]
    public async Task<ActionResult<IEnumerable<MemberDto>>> GetGroupMembers(Guid conversationId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var members = await _chatService.GetGroupMembersAsync(conversationId, userId.Value);
        // Enrich with online status
        var memberList = members.ToList();
        foreach (var m in memberList)
        {
            m.IsOnline = _connectionManager.IsUserOnline(m.UserId.ToString());
        }
        return Ok(memberList);
    }

    [HttpPost("group/{conversationId}/leave")]
    public async Task<IActionResult> LeaveGroup(Guid conversationId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var result = await _chatService.LeaveGroupAsync(conversationId, userId.Value);
        if (!result.Success) return BadRequest("Unable to leave group.");

        // Send system message
        var sysMsgContent = $"[SYSTEM] {result.UserName} đã rời nhóm.";
        try
        {
            var sysMsgDto = await _chatService.SendMessageAsync(userId.Value, conversationId, sysMsgContent);
            await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("ReceiveMessage", sysMsgDto);
        }
        catch { /* User already removed, skip system message */ }

        await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("MemberLeft", new { conversationId, userId = userId.Value, userName = result.UserName });

        return Ok();
    }

    public class KickMemberDto
    {
        public Guid MemberId { get; set; }
    }

    [HttpPost("group/{conversationId}/kick")]
    public async Task<IActionResult> KickMember(Guid conversationId, [FromBody] KickMemberDto dto)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var result = await _chatService.KickMemberAsync(conversationId, dto.MemberId, userId.Value);
        if (!result.Success) return BadRequest("Unable to kick member.");

        // Send system message
        var sysMsgContent = $"[SYSTEM] {result.UserName} đã bị xóa khỏi nhóm.";
        var sysMsgDto = await _chatService.SendMessageAsync(userId.Value, conversationId, sysMsgContent);
        await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("ReceiveMessage", sysMsgDto);

        // Notify kicked user
        var kickedConnections = _connectionManager.GetUserConnections(dto.MemberId.ToString());
        if (kickedConnections.Any())
        {
            await _hubContext.Clients.Clients(kickedConnections).SendAsync("MemberKicked", new { conversationId, userName = result.UserName });
        }

        return Ok();
    }

    [HttpPut("group/{conversationId}")]
    public async Task<IActionResult> RenameGroup(Guid conversationId, [FromBody] UpdateGroupDto dto)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized();

        var success = await _chatService.RenameGroupAsync(conversationId, userId.Value, dto.Name);
        if (!success) return BadRequest("Unable to rename group.");

        // Notify group
        await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("GroupRenamed", new { conversationId, newName = dto.Name });

        // System message
        var sysMsg = $"[SYSTEM] Nhóm đã được đổi tên thành \"{dto.Name}\".";
        var sysMsgDto = await _chatService.SendMessageAsync(userId.Value, conversationId, sysMsg);
        await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("ReceiveMessage", sysMsgDto);

        return Ok();
    }
}
