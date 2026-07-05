using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NexusChat.Domain.Entities;

namespace NexusChat.Infrastructure.Data;

public static class DataSeeder
{
    public static async Task SeedDataAsync(ApplicationDbContext context, IPasswordHasher<User> passwordHasher)
    {
        // Tự động apply pending migrations
        await context.Database.MigrateAsync();

        if (!await context.Users.AnyAsync())
        {
            var user1 = new User { UserName = "alice", Email = "alice@nexus.chat" };
            user1.PasswordHash = passwordHasher.HashPassword(user1, "Pa$$w0rd");

            var user2 = new User { UserName = "bob", Email = "bob@nexus.chat" };
            user2.PasswordHash = passwordHasher.HashPassword(user2, "Pa$$w0rd");

            await context.Users.AddRangeAsync(user1, user2);
            await context.SaveChangesAsync();
        }
    }
}
