FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["NexusChat.API/NexusChat.API.csproj", "NexusChat.API/"]
COPY ["NexusChat.Application/NexusChat.Application.csproj", "NexusChat.Application/"]
COPY ["NexusChat.Domain/NexusChat.Domain.csproj", "NexusChat.Domain/"]
COPY ["NexusChat.Infrastructure/NexusChat.Infrastructure.csproj", "NexusChat.Infrastructure/"]
RUN dotnet restore "NexusChat.API/NexusChat.API.csproj"
COPY . .
WORKDIR "/src/NexusChat.API"
RUN dotnet build "NexusChat.API.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "NexusChat.API.csproj" -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "NexusChat.API.dll"]
