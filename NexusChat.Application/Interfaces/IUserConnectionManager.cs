namespace NexusChat.Application.Interfaces;

public interface IUserConnectionManager
{
    void KeepUserConnection(string userId, string connectionId);
    void RemoveUserConnection(string connectionId);
    List<string> GetUserConnections(string userId);
    bool IsUserOnline(string userId);
}
