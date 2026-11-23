using System.Buffers.Binary;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

internal sealed class AuthChallengeStore(IMemoryCache memory, IConfiguration configuration, IServiceProvider services)
{
    private readonly PostgresAuthCache? postgres = services.GetService<PostgresAuthCache>();
    private readonly SemaphoreSlim[] gates = Enumerable.Range(0, 32).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    internal bool Persistent => postgres is not null;

    internal async Task<T> WithLock<T>(string key, Func<NpgsqlTransaction?, Task<T>> use, CancellationToken cancellation)
    {
        if (postgres is null)
        {
            var gate = gates[StringComparer.Ordinal.GetHashCode(key) & (gates.Length - 1)];
            await gate.WaitAsync(cancellation);
            try { return await use(null); }
            finally { gate.Release(); }
        }

        await using var connection = new NpgsqlConnection(configuration.GetConnectionString("Workspace"));
        await connection.OpenAsync(cancellation);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellation);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        await using var acquire = new NpgsqlCommand("SELECT pg_advisory_xact_lock(841924312, @key)", connection, transaction)
        {
            CommandTimeout = 5,
        };
        acquire.Parameters.AddWithValue("key", BinaryPrimitives.ReadInt32BigEndian(hash));
        await acquire.ExecuteNonQueryAsync(cancellation);
        var result = await use(transaction);
        cancellation.ThrowIfCancellationRequested();
        await transaction.CommitAsync(CancellationToken.None);
        return result;
    }

    internal async Task<T?> Get<T>(string key, NpgsqlTransaction? transaction, CancellationToken cancellation) where T : class
    {
        if (postgres is null) return memory.TryGetValue<T>(key, out var value) ? value : null;
        var data = transaction is null ? await postgres.GetAsync(key, cancellation)
            : await postgres.GetAsync(key, transaction, cancellation);
        return data is null ? null : JsonSerializer.Deserialize<T>(data);
    }

    internal Task Set<T>(string key, T value, DateTimeOffset expiresAt, NpgsqlTransaction? transaction, CancellationToken cancellation)
    {
        if (postgres is not null)
            return postgres.SetAsync(key, JsonSerializer.SerializeToUtf8Bytes(value), expiresAt, transaction!, cancellation);
        memory.Set(key, value, expiresAt);
        return Task.CompletedTask;
    }

    internal Task Remove(string key, NpgsqlTransaction? transaction, CancellationToken cancellation)
    {
        if (postgres is not null)
            return transaction is null ? postgres.RemoveAsync(key, cancellation) : postgres.RemoveAsync(key, transaction, cancellation);
        memory.Remove(key);
        return Task.CompletedTask;
    }

    internal Task<bool> ConsumeProof(string key, NpgsqlTransaction transaction, CancellationToken cancellation) =>
        postgres!.ConsumeAsync(key, transaction, cancellation);
}
