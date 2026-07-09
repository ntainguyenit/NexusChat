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

        // Seed other initial data here if needed in the future
    }
}
