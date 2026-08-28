const std = @import("std");

pub const model_context =
    "Runtime capabilities: this is the embedded browser version of fx, not locally installed fx. " ++
    "Public web fetch, web search, and general outbound network access are unavailable. " ++
    "Do not attempt curl, wget, package managers, raw sockets, or equivalent network workarounds through terminal commands. " ++
    "If the user asks for external web content, explain this limitation immediately and say that locally installed fx provides the full tool suite. " ++
    "When a browser workspace terminal is advertised, use it only for the files and commands that workspace exposes.";

/// Some hosts hand the workspace commands that do reach the network — a fetch
/// wrapper, an MCP tool bridged in as a command. Telling the model to refuse
/// external content there is simply wrong, and it strands the user in front of
/// a tool that works.
pub const networked_model_context =
    "Runtime capabilities: this is the embedded browser version of fx, not locally installed fx. " ++
    "There are no raw sockets and no package managers; outbound network access exists only through the commands this workspace exposes. " ++
    "Use those commands when the user asks for external content instead of saying it is unavailable, and read the workspace instructions to learn which ones exist. " ++
    "Do not attempt network workarounds the workspace does not list.";

/// `FX_BROWSER_NETWORK=1` is trusted host configuration, set by the embedder
/// that registered those commands. Anything else keeps the conservative notice.
pub fn modelContextForEnv(value: ?[]const u8) []const u8 {
    const setting = value orelse return model_context;
    if (std.mem.eql(u8, setting, "1") or std.ascii.eqlIgnoreCase(setting, "true")) {
        return networked_model_context;
    }
    return model_context;
}

test "browser model context refuses unavailable network workarounds" {
    try std.testing.expect(std.mem.find(u8, model_context, "Public web fetch, web search, and general outbound network access are unavailable") != null);
    try std.testing.expect(std.mem.find(u8, model_context, "Do not attempt curl, wget") != null);
    try std.testing.expect(std.mem.find(u8, model_context, "locally installed fx provides the full tool suite") != null);
}

test "hosts with network commands drop the blanket refusal" {
    try std.testing.expect(std.mem.find(u8, networked_model_context, "unavailable") == null);
    try std.testing.expect(std.mem.find(u8, networked_model_context, "only through the commands this workspace exposes") != null);
    try std.testing.expect(std.mem.find(u8, networked_model_context, "read the workspace instructions") != null);
}

test "only an explicit opt-in selects the networked notice" {
    try std.testing.expectEqualStrings(model_context, modelContextForEnv(null));
    try std.testing.expectEqualStrings(model_context, modelContextForEnv(""));
    try std.testing.expectEqualStrings(model_context, modelContextForEnv("0"));
    try std.testing.expectEqualStrings(model_context, modelContextForEnv("yes"));
    try std.testing.expectEqualStrings(networked_model_context, modelContextForEnv("1"));
    try std.testing.expectEqualStrings(networked_model_context, modelContextForEnv("true"));
    try std.testing.expectEqualStrings(networked_model_context, modelContextForEnv("TRUE"));
}
