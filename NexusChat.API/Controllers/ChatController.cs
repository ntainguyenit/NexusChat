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
}
