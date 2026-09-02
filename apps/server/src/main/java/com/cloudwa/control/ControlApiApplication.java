package com.cloudwa.control;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import com.cloudwa.control.config.DotenvLoader;

import java.nio.file.Path;

@SpringBootApplication
@ConfigurationPropertiesScan
public class ControlApiApplication {
    public static void main(String[] args) {
        DotenvLoader.loadIntoSystemProperties(Path.of("."));
        SpringApplication.run(ControlApiApplication.class, args);
    }
}
