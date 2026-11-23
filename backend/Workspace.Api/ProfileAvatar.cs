using System.Buffers.Binary;

internal static class ProfileAvatar
{
    private const int MaxBytes = 1_048_576;
    private const string FormatError = "Аватар должен быть изображением JPEG, PNG или WebP.";
    private const string SizeError = "Размер аватара не должен превышать 1 МБ.";
    private const string ImageError = "Не удалось проверить изображение. Поддерживаются JPEG, PNG и WebP размером до 2048×2048.";

    internal static (byte[]? Bytes, string? Mime, string? Error) Parse(string? value)
    {
        if (value is null) return (null, null, FormatError);
        var separator = value.IndexOf(',');
        if (separator < 0 || separator == value.Length - 1) return (null, null, FormatError);
        var mime = value.AsSpan(0, separator) switch
        {
            "data:image/png;base64" => "image/png",
            "data:image/jpeg;base64" => "image/jpeg",
            "data:image/webp;base64" => "image/webp",
            _ => null,
        };
        if (mime is null) return (null, null, FormatError);
        var encoded = value[(separator + 1)..];
        if (encoded.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '+' or '/' or '=')))
            return (null, null, FormatError);
        if (encoded.Length > ((MaxBytes + 2) / 3) * 4) return (null, null, SizeError);

        if (!encoded.Contains('=') && encoded.Length % 4 is 2 or 3)
            encoded = encoded.PadRight((encoded.Length + 3) / 4 * 4, '=');
        byte[] bytes;
        try { bytes = Convert.FromBase64String(encoded); }
        catch (FormatException) { return (null, null, SizeError); }
        if (bytes.Length > MaxBytes) return (null, null, SizeError);

        // Match the PHP endpoint's signature and dimension checks without decoding pixels.
        var dimensions = mime switch
        {
            "image/png" => PngSize(bytes),
            "image/jpeg" => JpegSize(bytes),
            _ => WebpSize(bytes),
        };
        if (dimensions is not { Width: >= 1 and <= 2048, Height: >= 1 and <= 2048 })
            return (null, null, ImageError);

        return (bytes, mime, null);
    }

    private static (uint Width, uint Height)? PngSize(ReadOnlySpan<byte> bytes)
    {
        ReadOnlySpan<byte> signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        if (bytes.Length < 33 || !bytes.StartsWith(signature)
            || BinaryPrimitives.ReadUInt32BigEndian(bytes[8..]) != 13 || !bytes[12..16].SequenceEqual("IHDR"u8))
            return null;
        return (BinaryPrimitives.ReadUInt32BigEndian(bytes[16..]), BinaryPrimitives.ReadUInt32BigEndian(bytes[20..]));
    }

    private static (uint Width, uint Height)? JpegSize(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 4 || bytes[0] != 0xff || bytes[1] != 0xd8) return null;
        var position = 2;
        while (position < bytes.Length && bytes[position] == 0xff)
        {
            while (position < bytes.Length && bytes[position] == 0xff) position++;
            if (position >= bytes.Length) return null;
            var marker = bytes[position++];
            if (marker is 0xda or 0xd9 or 0x00) return null;
            if (marker is 0x01 or >= 0xd0 and <= 0xd7) continue;
            if (bytes.Length - position < 2) return null;
            var size = BinaryPrimitives.ReadUInt16BigEndian(bytes[position..]);
            if (size < 2 || size > bytes.Length - position) return null;
            if (marker is >= 0xc0 and <= 0xcf and not (0xc4 or 0xc8 or 0xcc))
            {
                if (size < 8 || bytes[position + 7] == 0 || size != 8 + 3 * bytes[position + 7])
                    return null;
                return (BinaryPrimitives.ReadUInt16BigEndian(bytes[(position + 5)..]),
                    BinaryPrimitives.ReadUInt16BigEndian(bytes[(position + 3)..]));
            }
            position += size;
        }
        return null;
    }

    private static (uint Width, uint Height)? WebpSize(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 20 || !bytes.StartsWith("RIFF"u8) || !bytes[8..12].SequenceEqual("WEBP"u8))
            return null;
        var riffSize = BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..]);
        if (riffSize < 12 || riffSize > bytes.Length - 8) return null;
        var chunkSize = BinaryPrimitives.ReadUInt32LittleEndian(bytes[16..]);
        if (chunkSize > riffSize - 12) return null;
        var chunk = bytes.Slice(20, (int)chunkSize);
        if (bytes[12..16].SequenceEqual("VP8 "u8) && chunk.Length >= 10 && (chunk[0] & 1) == 0
            && chunk[3] == 0x9d && chunk[4] == 0x01 && chunk[5] == 0x2a)
            return ((uint)(BinaryPrimitives.ReadUInt16LittleEndian(chunk[6..]) & 0x3fff),
                (uint)(BinaryPrimitives.ReadUInt16LittleEndian(chunk[8..]) & 0x3fff));
        if (bytes[12..16].SequenceEqual("VP8L"u8) && chunk.Length >= 5 && chunk[0] == 0x2f)
        {
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(chunk[1..]);
            return ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
        }
        if (bytes[12..16].SequenceEqual("VP8X"u8) && chunk.Length == 10)
            return (ReadUInt24(chunk[4..]) + 1, ReadUInt24(chunk[7..]) + 1);
        return null;
    }

    private static uint ReadUInt24(ReadOnlySpan<byte> bytes) =>
        (uint)(bytes[0] | bytes[1] << 8 | bytes[2] << 16);
}
