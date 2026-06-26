# syntax=docker/dockerfile:1.6

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props global.json* ./
COPY src/Filament.Core/Filament.Core.csproj src/Filament.Core/
COPY src/Filament.Infrastructure/Filament.Infrastructure.csproj src/Filament.Infrastructure/
COPY src/Filament.Api/Filament.Api.csproj src/Filament.Api/
RUN dotnet restore src/Filament.Api/Filament.Api.csproj
COPY src/ src/
RUN dotnet publish src/Filament.Api/Filament.Api.csproj -c Release -o /out \
    /p:UseAppHost=false /p:DebugType=none /p:DebugSymbols=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ARG GIT_COMMIT=dev
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_gcServer=0 \
    DOTNET_GCConserveMemory=9 \
    APP_VERSION=$GIT_COMMIT
RUN echo "$GIT_COMMIT" > /app/VERSION
EXPOSE 8080
COPY --from=build /out ./
ENTRYPOINT ["dotnet", "Filament.Api.dll"]
