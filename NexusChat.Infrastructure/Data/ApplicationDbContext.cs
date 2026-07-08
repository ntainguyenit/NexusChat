using Microsoft.EntityFrameworkCore;
using NexusChat.Domain.Entities;

namespace NexusChat.Infrastructure.Data;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users { get; set; }
    public DbSet<Conversation> Conversations { get; set; }
    public DbSet<ConversationParticipant> ConversationParticipants { get; set; }
    public DbSet<Message> Messages { get; set; }
    public DbSet<Friendship> Friendships { get; set; }
    public DbSet<UserBlock> UserBlocks { get; set; }
    public DbSet<MessageReaction> MessageReactions { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.UserName).IsRequired().HasMaxLength(50);
            entity.HasIndex(e => e.UserName).IsUnique();
            entity.Property(e => e.Email).IsRequired().HasMaxLength(100);
            entity.HasIndex(e => e.Email).IsUnique();
        });

        modelBuilder.Entity<Conversation>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.GroupName).HasMaxLength(100);
        });

        modelBuilder.Entity<ConversationParticipant>(entity =>
        {
            entity.HasKey(e => new { e.ConversationId, e.UserId });

            entity.HasOne(e => e.Conversation)
                .WithMany(c => c.Participants)
                .HasForeignKey(e => e.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany(u => u.ConversationParticipants)
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Message>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Content).IsRequired();

            entity.HasOne(e => e.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(e => e.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Sender)
                .WithMany(u => u.SentMessages)
                .HasForeignKey(e => e.SenderId)
                .OnDelete(DeleteBehavior.Restrict);

            // Composite Index phục vụ pagination và query theo thời gian trong 1 conversation
            entity.HasIndex(e => new { e.ConversationId, e.SentAt });

            entity.HasOne(e => e.ParentMessage)
                .WithMany(m => m.Replies)
                .HasForeignKey(e => e.ParentMessageId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Friendship>(entity =>
        {
            entity.HasKey(e => new { e.UserId, e.FriendId });

            entity.HasOne(e => e.User)
                .WithMany(u => u.FriendshipsInitiated)
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Friend)
                .WithMany(u => u.FriendshipsReceived)
                .HasForeignKey(e => e.FriendId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<UserBlock>(entity =>
        {
            entity.HasKey(e => new { e.BlockerId, e.BlockedId });

            entity.HasOne(e => e.Blocker)
                .WithMany(u => u.BlocksInitiated)
                .HasForeignKey(e => e.BlockerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Blocked)
                .WithMany(u => u.BlocksReceived)
                .HasForeignKey(e => e.BlockedId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<MessageReaction>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ReactionType).IsRequired().HasMaxLength(20);

            entity.HasOne(e => e.Message)
                .WithMany(m => m.Reactions)
                .HasForeignKey(e => e.MessageId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany(u => u.Reactions)
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            
            // Một User chỉ có thể reaction 1 type duy nhất trên 1 message (nếu muốn nhiều type thì sửa)
            // Tạm thời cho phép nhiều type hoặc 1 type, để đơn giản thiết lập 1 reaction mỗi message/user
            entity.HasIndex(e => new { e.MessageId, e.UserId }).IsUnique();
        });
    }
}
