using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NexusChat.Application.DTOs;
using NexusChat.Application.Interfaces;
using NexusChat.Domain.Entities;
using NexusChat.Infrastructure.Data;

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

    [HttpPost("register")]
    public async Task<ActionResult<AuthResultDto>> Register(RegisterDto dto)
    {
        if (await _context.Users.AnyAsync(u => u.UserName == dto.UserName))
            return BadRequest("Username is already taken");

        if (await _context.Users.AnyAsync(u => u.Email == dto.Email))
            return BadRequest("Email is already registered");

        var user = new User
        {
            UserName = dto.UserName,
            Email = dto.Email
        };

        user.PasswordHash = _passwordHasher.HashPassword(user, dto.Password);

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

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

    [HttpPost("login")]
    public async Task<ActionResult<AuthResultDto>> Login(LoginDto dto)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.UserName == dto.UserName);

        if (user == null)
            return Unauthorized("Invalid username or password");

        var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, dto.Password);
        
        if (result == PasswordVerificationResult.Failed)
            return Unauthorized("Invalid username or password");

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
}
