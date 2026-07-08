using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusChat.Application.Interfaces;

namespace NexusChat.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class BlocksController : ControllerBase
{
    private readonly IChatService _chatService;

    public BlocksController(IChatService chatService)
    {
        _chatService = chatService;
    }

    private Guid GetUserId() => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> GetBlocks()
    {
        var blocks = await _chatService.GetBlockedUsersAsync(GetUserId());
        return Ok(blocks);
    }

    [HttpPost("{blockedId}")]
    public async Task<IActionResult> BlockUser(Guid blockedId)
    {
        var success = await _chatService.BlockUserAsync(GetUserId(), blockedId);
        if (success) return Ok(new { message = "User blocked successfully" });
        return BadRequest(new { message = "Failed to block user" });
    }

    [HttpDelete("{blockedId}")]
    public async Task<IActionResult> UnblockUser(Guid blockedId)
    {
        var success = await _chatService.UnblockUserAsync(GetUserId(), blockedId);
        if (success) return Ok(new { message = "User unblocked successfully" });
        return BadRequest(new { message = "Failed to unblock user" });
    }
}
