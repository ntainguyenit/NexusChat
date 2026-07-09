using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using NexusChat.API.Hubs;
using NexusChat.Application.Interfaces;

namespace NexusChat.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FriendsController : ControllerBase
{
    private readonly IChatService _chatService;
    private readonly IHubContext<ChatHub> _hubContext;
    private readonly IUserConnectionManager _connectionManager;

    public FriendsController(
        IChatService chatService, 
        IHubContext<ChatHub> hubContext,
        IUserConnectionManager connectionManager)
    {
        _chatService = chatService;
        _hubContext = hubContext;
        _connectionManager = connectionManager;
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

    [HttpPost("request/{email}")]
    public async Task<IActionResult> SendRequest(string email)
    {
        var result = await _chatService.SendFriendRequestAsync(GetUserId(), email);
        if (result.Item1)
        {
            var receiverIdStr = result.Item2.ToString();
            var connections = _connectionManager.GetUserConnections(receiverIdStr);
            if (connections.Any())
            {
                await _hubContext.Clients.Clients(connections).SendAsync("ReceiveFriendRequest");
            }
            return Ok(new { message = "Request sent successfully" });
        }
        return BadRequest(new { message = "Failed to send request" });
    }

    [HttpPost("accept/{friendId}")]
    public async Task<IActionResult> AcceptRequest(Guid friendId)
    {
        var success = await _chatService.AcceptFriendRequestAsync(GetUserId(), friendId);
        if (success)
        {
            var connections = _connectionManager.GetUserConnections(friendId.ToString());
            if (connections.Any())
            {
                await _hubContext.Clients.Clients(connections).SendAsync("FriendRequestAccepted", GetUserId());
            }
            return Ok(new { message = "Request accepted" });
        }
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
        if (success)
        {
            var connections = _connectionManager.GetUserConnections(friendId.ToString());
            if (connections.Any())
            {
                await _hubContext.Clients.Clients(connections).SendAsync("FriendRemoved", GetUserId());
            }
            return Ok(new { message = "Friend removed" });
        }
        return BadRequest(new { message = "Failed to remove friend" });
    }
}
