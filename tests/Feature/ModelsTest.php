<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Tests\DatabaseTestCase;

class ModelsTest extends DatabaseTestCase
{
    public function test_existing_password_hashes_and_username_login_are_compatible(): void
    {
        $hash = password_hash('LegacyPassword123', PASSWORD_BCRYPT, ['cost' => 4]);
        $id = DB::table('users')->insertGetId(['username' => 'LegacyUser', 'password_hash' => $hash]);
        $user = User::findOrFail($id);

        $this->assertSame('password_hash', $user->getAuthPasswordName());
        $this->assertSame($hash, $user->getAuthPassword());
        $this->assertTrue(Auth::attempt(['username' => 'LegacyUser', 'password' => 'LegacyPassword123']));
        $this->assertSame($id, Auth::id());

        $user->about = 'Updated without an updated_at column';
        $user->save();
        $this->assertSame($hash, $user->fresh()->getAuthPassword());
        $this->assertNotNull($user->fresh()->created_at);
    }

    public function test_credentials_and_avatar_bytes_are_not_serialized(): void
    {
        $user = $this->createUser();
        $bytes = "\x00\x01avatar-test\xff";
        DB::update(
            "UPDATE users SET avatar_data = decode(?, 'base64'), avatar_mime = 'image/png' WHERE id = ?",
            [base64_encode($bytes), $user->id],
        );

        $serialized = $user->fresh()->toArray();
        $this->assertArrayNotHasKey('password_hash', $serialized);
        $this->assertArrayNotHasKey('avatar_data', $serialized);
        $this->assertArrayNotHasKey('avatar_mime', $serialized);
        $stored = DB::selectOne("SELECT encode(avatar_data, 'base64') AS bytes FROM users WHERE id = ?", [$user->id]);
        $this->assertSame(base64_encode($bytes), $stored->bytes);
    }

    public function test_relationships_boolean_casts_and_task_order_use_the_legacy_schema(): void
    {
        $user = $this->createUser();
        $board = $user->boards()->create(['name' => 'Test board', 'is_default' => true]);
        $flag = $user->flags()->make(['name' => 'Test flag']);
        $flag->board()->associate($board);
        $flag->save();
        $list = $user->taskLists()->make(['name' => 'Test list', 'is_important' => true]);
        $list->board()->associate($board);
        $list->flag()->associate($flag);
        $list->save();

        foreach ([2, 0, 1] as $position) {
            $task = $user->tasks()->make(['title' => 'Task '.$position, 'sort_order' => $position]);
            $task->taskList()->associate($list);
            $task->save();
        }

        $this->assertSame($user->id, $board->user->id);
        $this->assertTrue($board->fresh()->is_default);
        $this->assertTrue($list->fresh()->is_important);
        $this->assertSame($list->id, $board->taskLists()->first()->id);
        $this->assertSame($flag->id, $board->flags()->first()->id);
        $this->assertSame($list->id, $flag->taskLists()->first()->id);
        $this->assertSame([0, 1, 2], $list->tasks()->pluck('sort_order')->all());

        $task = $list->tasks()->first();
        $this->assertFalse($task->is_completed);
        $task->update(['is_completed' => true]);
        $this->assertTrue($task->fresh()->is_completed);

        $flag->delete();
        $this->assertNull($list->fresh()->flag_id);
        $this->assertSame($user->id, $list->fresh()->user_id);
        $this->assertSame($board->id, $list->fresh()->board_id);

        $list->delete();
        $this->assertSame(0, $user->tasks()->count());
    }

    public function test_the_database_rejects_a_list_on_another_users_board(): void
    {
        $owner = $this->createUser();
        $otherUser = $this->createUser();
        $board = $otherUser->boards()->create(['name' => 'Private board']);
        $list = $owner->taskLists()->make(['name' => 'Invalid list']);
        $list->board()->associate($board);

        $this->expectException(QueryException::class);
        $list->save();
    }

    public function test_the_database_rejects_a_flag_from_another_board(): void
    {
        $user = $this->createUser();
        $first = $user->boards()->create(['name' => 'First']);
        $second = $user->boards()->create(['name' => 'Second']);
        $flag = $user->flags()->make(['name' => 'Only first board']);
        $flag->board()->associate($first);
        $flag->save();
        $list = $user->taskLists()->make(['name' => 'Invalid flag']);
        $list->board()->associate($second);
        $list->flag()->associate($flag);

        $this->expectException(QueryException::class);
        $list->save();
    }
}
