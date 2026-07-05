using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NexusChat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddGroupApprovalFlow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsAdmin",
                table: "ConversationParticipants",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Status",
                table: "ConversationParticipants",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsAdmin",
                table: "ConversationParticipants");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "ConversationParticipants");
        }
    }
}
