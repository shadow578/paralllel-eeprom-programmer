#include <Arduino.h>
#define CHECK_BIT(var, pos) ((var) & (1 << (pos)))

#pragma region pin assignments

// EEPROM I/O pin connections
#define EEPROM_IO_0 A0
#define EEPROM_IO_1 A1
#define EEPROM_IO_2 A2
#define EEPROM_IO_3 8
#define EEPROM_IO_4 9
#define EEPROM_IO_5 10
#define EEPROM_IO_6 11
#define EEPROM_IO_7 12

// EEPROM address shift register connections
#define EEPROM_ADR_DATA 4
#define EEPROM_ADR_SCLK 2
#define EEPROM_ADR_RCLK 3

// EEPROM control lines
#define EEPROM_WE 7
#define EEPROM_OE 6
#define EEPROM_CE 5
#pragma endregion

#define WRITE_TIMEOUT_MS 100

// ~~ internal api ~~
void _set_addr(uint16_t address);
void _set_bus_mode(uint8_t mode);
void _write_bus(uint8_t data);
uint8_t _read_bus();
void _write_eeprom(uint16_t address, uint8_t data);

void _set_chip_enable(bool ce);
void _set_output_enable(bool oe);
void _set_write_enable(bool we);

// ~~ command api ~~
void sdp_enable();
void sdp_disable();
void chip_erase();

// ~~ public api ~~
void initEEPROM();
uint8_t readByte(uint16_t address);
bool writeByte(uint16_t address, uint8_t data);
bool writePage(uint16_t start, uint8_t *data, uint16_t len);

void ensureSDPEnabled();
void ensureSDPDisabled();
