<?php

return [
    'url' => env('WORKSPACE_BRIDGE_URL', 'http://127.0.0.1:8002'),
    'secret' => env('WORKSPACE_BRIDGE_SECRET', ''),
    'toggle_task' => env('WORKSPACE_BRIDGE_TOGGLE_TASK', false),
    'update_task' => env('WORKSPACE_BRIDGE_UPDATE_TASK', false),
    'create_task' => env('WORKSPACE_BRIDGE_CREATE_TASK', false),
    'move_task' => env('WORKSPACE_BRIDGE_MOVE_TASK', false),
    'reorder_task' => env('WORKSPACE_BRIDGE_REORDER_TASK', false),
    'delete_task' => env('WORKSPACE_BRIDGE_DELETE_TASK', false),
    'stop_task_repeat' => env('WORKSPACE_BRIDGE_STOP_TASK_REPEAT', false),
    'repeat_tasks' => env('WORKSPACE_BRIDGE_REPEAT_TASKS', false),
];
