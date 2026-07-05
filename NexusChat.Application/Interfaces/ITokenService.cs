using NexusChat.Domain.Entities;

namespace NexusChat.Application.Interfaces;

public interface ITokenService
{
    string CreateToken(User user);
}
