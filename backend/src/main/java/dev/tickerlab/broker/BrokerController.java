package dev.tickerlab.broker;

import dev.tickerlab.broker.dto.BrokerAccountRequest;
import dev.tickerlab.broker.dto.BrokerAccountResponse;
import dev.tickerlab.broker.dto.ImportResultResponse;
import dev.tickerlab.broker.dto.SymbolMapRequest;
import dev.tickerlab.broker.dto.TransactionResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/broker/accounts")
public class BrokerController {

    private final BrokerService service;

    BrokerController(BrokerService service) {
        this.service = service;
    }

    @GetMapping
    public List<BrokerAccountResponse> list() {
        return service.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BrokerAccountResponse create(@Valid @RequestBody BrokerAccountRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    public BrokerAccountResponse rename(@PathVariable UUID id,
                                        @Valid @RequestBody BrokerAccountRequest request) {
        return service.rename(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }

    /** Returns the whole account back, so the panel repaints from the import's own response. */
    @PostMapping("/{id}/import")
    public ImportResultResponse importStatement(@PathVariable UUID id,
                                                @RequestParam("file") MultipartFile file) {
        return service.importStatement(id, file);
    }

    /**
     * Names an ISIN, for this user and not for one account: the answer is the same in all of them.
     * Returns the accounts back already marked to market, so the panel repaints from the response
     * instead of firing a second load to see the price it just unlocked.
     */
    @PutMapping("/symbols")
    public List<BrokerAccountResponse> mapSymbol(@Valid @RequestBody SymbolMapRequest request) {
        service.mapSymbol(request.isin(), request.symbol());
        return service.list();
    }

    @GetMapping("/{id}/transactions")
    public List<TransactionResponse> transactions(@PathVariable UUID id) {
        return service.transactions(id);
    }

    @ExceptionHandler(BrokerExceptions.AccountNotFoundException.class)
    ResponseEntity<Map<String, String>> handleNotFound(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(BrokerExceptions.DuplicateNameException.class)
    ResponseEntity<Map<String, String>> handleDuplicate(RuntimeException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", ex.getMessage()));
    }

    /** A file that is not the statement it claims is the user's mistake, not the server's. */
    @ExceptionHandler(BrokerExceptions.UnreadableStatementException.class)
    ResponseEntity<Map<String, String>> handleUnreadable(RuntimeException ex) {
        return ResponseEntity.unprocessableEntity().body(Map.of("error", ex.getMessage()));
    }
}
