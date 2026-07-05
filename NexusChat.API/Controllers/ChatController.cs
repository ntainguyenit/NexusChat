using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusChat.Application.DTOs;
using NexusChat.Application.Interfaces;

namespace NexusChat.API.Controllers;

[Authorize]
[ApiController]
[Route("api/[controller]")]
public class ChatController : ControllerBase
{
    private readonly IChatService _chatService;

    public ChatController(IChatService chatService)
    {
        _chatService = chatService;
    }

    [HttpGet("messages/{conversationId}")]
    public async Task<ActionResult<IEnumerable<MessageDto>>> GetMessages(Guid conversationId, [FromQuery] int skip = 0, [FromQuery] int take = 20)
    {
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
        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(currentUserIdStr) || !Guid.TryParse(currentUserIdStr, out var currentUserId))
            return Unauthorized();
            
        dto.ParticipantIds.Add(currentUserId);
        var distinctIds = dto.ParticipantIds.Distinct().ToList();
        
        var conversation = await _chatService.CreateGroupConversationAsync(dto.Name, distinctIds);
        
        return Ok(new ConversationDto 
        { 
            Id = conversation.Id, 
            IsGroup = conversation.IsGroup,
            Name = conversation.GroupName ?? string.Empty
        });
    }
}
