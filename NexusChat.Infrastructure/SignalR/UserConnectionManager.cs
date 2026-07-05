using System.Collections.Concurrent;
using NexusChat.Application.Interfaces;

namespace NexusChat.Infrastructure.SignalR;

public class UserConnectionManager : IUserConnectionManager
{
    // Cấu trúc map UserId -> Danh sách các ConnectionId (hỗ trợ multi-device)
    private readonly ConcurrentDictionary<string, ConcurrentBag<string>> _userConnections = new();
    
    // Reverse map để dễ dàng tìm UserId khi biết ConnectionId (lúc disconnect)
    private readonly ConcurrentDictionary<string, string> _connectionUserMap = new();

    public void KeepUserConnection(string userId, string connectionId)
    {
        _userConnections.AddOrUpdate(userId, 
            new ConcurrentBag<string> { connectionId },
            (key, existingBag) => 
            {
                if (!existingBag.Contains(connectionId))
                {
                    existingBag.Add(connectionId);
                }
                return existingBag;
            });
            
        _connectionUserMap.TryAdd(connectionId, userId);
    }

    public void RemoveUserConnection(string connectionId)
    {
        if (_connectionUserMap.TryRemove(connectionId, out var userId))
        {
            if (_userConnections.TryGetValue(userId, out var connections))
            {
                // Remove from bag is tricky, so we create a new bag without this connectionId
                var newBag = new ConcurrentBag<string>(connections.Where(c => c != connectionId));
                if (newBag.IsEmpty)
                {
                    _userConnections.TryRemove(userId, out _);
                }
                else
                {
                    _userConnections[userId] = newBag;
                }
            }
        }
    }

    public List<string> GetUserConnections(string userId)
    {
        if (_userConnections.TryGetValue(userId, out var connections))
        {
            return connections.ToList();
        }
        return new List<string>();
    }
}
