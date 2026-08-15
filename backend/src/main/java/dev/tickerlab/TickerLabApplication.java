package dev.tickerlab;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;

@SpringBootApplication
@EnableCaching
public class TickerLabApplication {

    public static void main(String[] args) {
        SpringApplication.run(TickerLabApplication.class, args);
    }
}
