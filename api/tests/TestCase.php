<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        if (is_string($uri) && str_starts_with($uri, '/api')) {
            $uri = substr($uri, 4) ?: '/';
        }

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }
}
