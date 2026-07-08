using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NexusChat.Application.Interfaces;

namespace NexusChat.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FriendsController : ControllerBase
{
    private readonly IChatService _chatService;

    public FriendsController(IChatService chatService)
    {
        _chatService = chatService;
    }

    private Guid GetUserId() => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<IActionResult> GetFriends()
    {
        var friends = await _chatService.GetFriendsListAsync(GetUserId());
        return Ok(friends);
    }

    [HttpGet("requests")]
    public async Task<IActionResult> GetRequests()
    {
        var requests = await _chatService.GetPendingFriendRequestsAsync(GetUserId());
        return Ok(requests);
    }

    [HttpPost("request/{username}")]
    public async Task<IActionResult> SendRequest(string username)
    {
        var success = await _chatService.SendFriendRequestAsync(GetUserId(), username);
        if (success) return Ok(new { message = "Request sent successfully" });
        return BadRequest(new { message = "Failed to send request" });
    }

    [HttpPost("accept/{friendId}")]
    public async Task<IActionResult> AcceptRequest(Guid friendId)
    {
        var success = await _chatService.AcceptFriendRequestAsync(GetUserId(), friendId);
        if (success) return Ok(new { message = "Request accepted" });
        return BadRequest(new { message = "Failed to accept request" });
    }

    [HttpPost("reject/{friendId}")]
    public async Task<IActionResult> RejectRequest(Guid friendId)
    {
        var success = await _chatService.RejectFriendRequestAsync(GetUserId(), friendId);
        if (success) return Ok(new { message = "Request rejected" });
        return BadRequest(new { message = "Failed to reject request" });
    }

    [HttpDelete("{friendId}")]
    public async Task<IActionResult> RemoveFriend(Guid friendId)
    {
        var success = await _chatService.RemoveFriendAsync(GetUserId(), friendId);
        if (success) return Ok(new { message = "Friend removed" });
        return BadRequest(new { message = "Failed to remove friend" });
    }
}
