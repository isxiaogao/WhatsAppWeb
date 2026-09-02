package com.cloudwa.control.provider;

public record ProviderHealth(boolean ok, String endpoint, String version, String error) {}
