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

    [HttpGet("messages/{conversationId}")]
    public async Task<ActionResult<IEnumerable<MessageDto>>> GetMessages(Guid conversationId, [FromQuery] int skip = 0, [FromQuery] int take = 20)
    {
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();
            
        var isApproved = await _chatService.IsApprovedParticipantAsync(conversationId, currentUserId);
        if (!isApproved)
            return Forbid();

        var messages = await _chatService.GetMessagesAsync(conversationId, skip, take);
        return Ok(messages);
    }
    [HttpGet("private/{otherUserId}")]
    public async Task<ActionResult<ConversationDto>> GetPrivateConversation(Guid otherUserId)
    {
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();
            
        var conversation = await _chatService.GetOrCreatePrivateConversationAsync(currentUserId, otherUserId);
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
            var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
                return Unauthorized();
                
            if (dto.ParticipantIds == null)
                dto.ParticipantIds = new List<Guid>();

            dto.ParticipantIds.Add(currentUserId);
            var distinctIds = dto.ParticipantIds.Distinct().ToList();
            
            var conversation = await _chatService.CreateGroupConversationAsync(dto.Name, currentUserId, distinctIds);
            
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
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();
            
        var conversation = await _chatService.JoinGroupAsync(currentUserId, dto.Code);
        if (conversation == null) return BadRequest("Invalid group code or group does not exist.");
        
        // Notify admin via SignalR
        var isApproved = await _chatService.IsApprovedParticipantAsync(conversation.Id, currentUserId);

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
                    RequesterId = currentUserId,
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
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();

        var requests = await _chatService.GetPendingRequestsAsync(currentUserId);
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
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();

        var requesterName = await _chatService.ApproveJoinRequestAsync(dto.ConversationId, dto.RequesterId, currentUserId);
        if (requesterName == null) return BadRequest("Unable to approve request.");

        // Notify user via SignalR
        var userConnections = _connectionManager.GetUserConnections(dto.RequesterId.ToString());
        if (userConnections.Any())
        {
            await _hubContext.Clients.Clients(userConnections).SendAsync("JoinRequestApproved", dto.ConversationId);
        }

        // Send System Message to Group
        var sysMsgContent = $"[SYSTEM] {requesterName} vừa tham gia nhóm.";
        var sysMsgDto = await _chatService.SendMessageAsync(currentUserId, dto.ConversationId, sysMsgContent);
        await _hubContext.Clients.Group(dto.ConversationId.ToString()).SendAsync("ReceiveMessage", sysMsgDto);

        return Ok();
    }

    [HttpPost("group/reject")]
    public async Task<IActionResult> RejectRequest([FromBody] ReviewRequestDto dto)
    {
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();

        var success = await _chatService.RejectJoinRequestAsync(dto.ConversationId, dto.RequesterId, currentUserId);
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
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();

        var success = await _chatService.DisbandGroupAsync(conversationId, currentUserId);
        if (!success) return BadRequest("Unable to disband group.");

        // Notify group members
        await _hubContext.Clients.Group(conversationId.ToString()).SendAsync("GroupDisbanded", conversationId);

        return Ok();
    }

    [HttpGet("conversations")]
    public async Task<ActionResult<IEnumerable<ConversationDto>>> GetConversations()
    {
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();
            
        var conversations = await _chatService.GetConversationsAsync(currentUserId);
        return Ok(conversations);
    }
}
