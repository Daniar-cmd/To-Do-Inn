<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as LaravelTestCase;
use RuntimeException;

abstract class TestCase extends LaravelTestCase
{
    public function createApplication()
    {
        $app = parent::createApplication();

        if ($app->configurationIsCached()) {
            throw new RuntimeException('Refusing to test with cached configuration. Clear the local config cache first.');
        }

        return $app;
    }
}
