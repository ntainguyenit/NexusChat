using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NexusChat.Application.DTOs;
using NexusChat.Application.Interfaces;
using NexusChat.Domain.Entities;
using NexusChat.Infrastructure.Data;
using Google.Apis.Auth;

namespace NexusChat.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ITokenService _tokenService;
    private readonly IPasswordHasher<User> _passwordHasher;
    private readonly IUserConnectionManager _connectionManager;

    public AuthController(
        ApplicationDbContext context, 
        ITokenService tokenService, 
        IPasswordHasher<User> passwordHasher,
        IUserConnectionManager connectionManager)
    {
        _context = context;
        _tokenService = tokenService;
        _passwordHasher = passwordHasher;
        _connectionManager = connectionManager;
    }

    [HttpPost("google-login")]
    public async Task<ActionResult<AuthResultDto>> GoogleLogin([FromBody] GoogleLoginDto dto)
    {
        try
        {
            var payload = await GoogleJsonWebSignature.ValidateAsync(dto.IdToken);
            
            // Email is required
            if (string.IsNullOrEmpty(payload.Email))
                return BadRequest("Google token does not contain email.");

            var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == payload.Email);
            
            if (user == null)
            {
                // Create new user
                user = new User
                {
                    Email = payload.Email,
                    // We use the email name or google name as default username
                    UserName = !string.IsNullOrEmpty(payload.Name) ? payload.Name : payload.Email.Split('@')[0],
                    PasswordHash = string.Empty // No password for google accounts
                };
                
                // Ensure unique username if needed (basic handling)
                int suffix = 1;
                var baseUserName = user.UserName;
                while (await _context.Users.AnyAsync(u => u.UserName == user.UserName))
                {
                    user.UserName = $"{baseUserName}{suffix}";
                    suffix++;
                }

                _context.Users.Add(user);
                await _context.SaveChangesAsync();
            }

            var token = _tokenService.CreateToken(user);

            return Ok(new AuthResultDto
            {
                Token = token,
                User = new UserDto
                {
                    Id = user.Id,
                    UserName = user.UserName,
                    Email = user.Email
                }
            });
        }
        catch (InvalidJwtException)
        {
            return Unauthorized("Invalid Google token.");
        }
    }

    [HttpGet("users")]
    public async Task<ActionResult<IEnumerable<UserDto>>> GetUsers()
    {
        var users = await _context.Users
            .Select(u => new UserDto
            {
                Id = u.Id,
                UserName = u.UserName,
                Email = u.Email
            }).ToListAsync();
            
        foreach(var u in users)
        {
            u.IsOnline = _connectionManager.IsUserOnline(u.Id.ToString());
        }
            
        return Ok(users);
    }

    [HttpGet("search")]
    public async Task<ActionResult<IEnumerable<UserDto>>> SearchUsers([FromQuery] string query)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length < 2)
            return Ok(new List<UserDto>());

        var currentUserIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var currentUserId = Guid.Parse(currentUserIdStr!);
        
        var existingFriendIds = await _context.Friendships
            .Where(f => f.UserId == currentUserId || f.FriendId == currentUserId)
            .Select(f => f.UserId == currentUserId ? f.FriendId : f.UserId)
            .ToListAsync();
        
        var users = await _context.Users
            .Where(u => u.Id != currentUserId && !existingFriendIds.Contains(u.Id) && (u.UserName.Contains(query) || u.Email.Contains(query)))
            .Take(10)
            .Select(u => new UserDto
            {
                Id = u.Id,
                UserName = u.UserName,
                Email = u.Email
            }).ToListAsync();
            
        return Ok(users);
    }

    [Authorize]
    [HttpPut("profile")]
    public async Task<ActionResult<UserDto>> UpdateProfile([FromBody] UpdateProfileDto dto)
    {
        var userIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
            return Unauthorized();

        var user = await _context.Users.FindAsync(userId);
        if (user == null) return NotFound();

        // Check uniqueness for UserName only
        if (dto.UserName != user.UserName && await _context.Users.AnyAsync(u => u.UserName == dto.UserName))
            return BadRequest("Username is already taken");

        user.UserName = dto.UserName;
        // Do NOT allow updating Email since it's linked to Google Account
        // user.Email = dto.Email; 
        
        await _context.SaveChangesAsync();

        return Ok(new UserDto
        {
            Id = user.Id,
            UserName = user.UserName,
            Email = user.Email // Return the original email
        });
    }

    [Authorize]
    [HttpPut("password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordDto dto)
    {
        var userIdStr = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdStr) || !Guid.TryParse(userIdStr, out var userId))
            return Unauthorized();

        var user = await _context.Users.FindAsync(userId);
        if (user == null) return NotFound();

        var verification = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, dto.CurrentPassword);
        if (verification == PasswordVerificationResult.Failed)
            return BadRequest("Mật khẩu hiện tại không đúng");

        user.PasswordHash = _passwordHasher.HashPassword(user, dto.NewPassword);
        await _context.SaveChangesAsync();

        return Ok(new { message = "Đổi mật khẩu thành công" });
    }
}
