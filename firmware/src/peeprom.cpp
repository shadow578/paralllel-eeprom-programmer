#include "peeprom.hpp"

#pragma region internal API
void _set_addr(uint16_t address)
{
    // write the data
    shiftOut(EEPROM_ADR_DATA, EEPROM_ADR_SCLK, MSBFIRST, ((address >> 8) & 0xFF));
    shiftOut(EEPROM_ADR_DATA, EEPROM_ADR_SCLK, MSBFIRST, (address & 0xFF));

    // shift into output register
    digitalWrite(EEPROM_ADR_RCLK, HIGH);
    digitalWrite(EEPROM_ADR_RCLK, LOW);
}

void _set_bus_mode(uint8_t mode)
{
    pinMode(EEPROM_IO_0, mode);
    pinMode(EEPROM_IO_1, mode);
    pinMode(EEPROM_IO_2, mode);
    pinMode(EEPROM_IO_3, mode);
    pinMode(EEPROM_IO_4, mode);
    pinMode(EEPROM_IO_5, mode);
    pinMode(EEPROM_IO_6, mode);
    pinMode(EEPROM_IO_7, mode);
}

void _write_bus(uint8_t data)
{
    // set data pins to output
    _set_bus_mode(OUTPUT);

    // write data to the pins
    digitalWrite(EEPROM_IO_0, CHECK_BIT(data, 0) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_1, CHECK_BIT(data, 1) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_2, CHECK_BIT(data, 2) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_3, CHECK_BIT(data, 3) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_4, CHECK_BIT(data, 4) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_5, CHECK_BIT(data, 5) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_6, CHECK_BIT(data, 6) ? HIGH : LOW);
    digitalWrite(EEPROM_IO_7, CHECK_BIT(data, 7) ? HIGH : LOW);
}

uint8_t _read_bus()
{
    // set data pins to input
    _set_bus_mode(INPUT);

    // read data from the pins
    uint8_t data = 0;
    data |= (digitalRead(EEPROM_IO_0) ? 1 : 0) << 0;
    data |= (digitalRead(EEPROM_IO_1) ? 1 : 0) << 1;
    data |= (digitalRead(EEPROM_IO_2) ? 1 : 0) << 2;
    data |= (digitalRead(EEPROM_IO_3) ? 1 : 0) << 3;
    data |= (digitalRead(EEPROM_IO_4) ? 1 : 0) << 4;
    data |= (digitalRead(EEPROM_IO_5) ? 1 : 0) << 5;
    data |= (digitalRead(EEPROM_IO_6) ? 1 : 0) << 6;
    data |= (digitalRead(EEPROM_IO_7) ? 1 : 0) << 7;
    return data;
}

void _write_eeprom(uint16_t address, uint8_t data)
{
    // put address and data on busses
    _set_addr(address);
    _write_bus(data);

    // strobe WE
    _set_write_enable(true);
    // delayMicroseconds(1);
    _set_write_enable(false);
}

void _set_chip_enable(bool ce)
{
    digitalWrite(EEPROM_CE, ce ? LOW : HIGH);
}

void _set_output_enable(bool oe)
{
    digitalWrite(EEPROM_OE, oe ? LOW : HIGH);
}

void _set_write_enable(bool we)
{
    digitalWrite(EEPROM_WE, we ? LOW : HIGH);
}
#pragma endregion

#pragma region command internal API
void sdp_enable()
{
    _set_output_enable(false);
    _set_chip_enable(true);
    _set_bus_mode(OUTPUT);

    _write_eeprom(0x5555, 0xAA);
    _write_eeprom(0x2AAA, 0x55);
    _write_eeprom(0x5555, 0xA0);

    _set_chip_enable(false);
    // delay(100);
}

void sdp_disable()
{
    _set_output_enable(false);
    _set_chip_enable(true);
    _set_bus_mode(OUTPUT);

    _write_eeprom(0x5555, 0xAA);
    _write_eeprom(0x2AAA, 0x55);
    _write_eeprom(0x5555, 0x80);
    _write_eeprom(0x5555, 0xAA);
    _write_eeprom(0x2AAA, 0x55);
    _write_eeprom(0x5555, 0x20);

    _set_chip_enable(false);
    // delay(100);
}

void chip_erase()
{
    _set_output_enable(false);
    _set_chip_enable(true);
    _set_bus_mode(OUTPUT);

    _write_eeprom(0x5555, 0xAA);
    _write_eeprom(0x2AAA, 0x55);
    _write_eeprom(0x5555, 0x80);
    _write_eeprom(0x5555, 0xAA);
    _write_eeprom(0x2AAA, 0x55);
    _write_eeprom(0x5555, 0x10);

    _set_chip_enable(false);
    delay(100);
}
#pragma endregion

void initEEPROM()
{
    // I/O pins
    _set_bus_mode(INPUT);

    // address output
    pinMode(EEPROM_ADR_DATA, OUTPUT);
    pinMode(EEPROM_ADR_SCLK, OUTPUT);
    pinMode(EEPROM_ADR_RCLK, OUTPUT);

    // control pins
    _set_chip_enable(false);
    _set_output_enable(false);
    _set_write_enable(false);
    pinMode(EEPROM_CE, OUTPUT);
    pinMode(EEPROM_OE, OUTPUT);
    pinMode(EEPROM_WE, OUTPUT);
}

uint8_t readByte(uint16_t address)
{
    // enable OE
    _set_bus_mode(INPUT);
    _set_output_enable(true);

    // select chip
    _set_chip_enable(true);

    // read data from bus
    _set_addr(address);
    uint8_t d = _read_bus();

    // disable chip and output
    _set_output_enable(false);
    _set_chip_enable(false);
    return d;
}

bool writeByte(uint16_t address, uint8_t data)
{
    // disable OE
    _set_output_enable(false);
    _set_bus_mode(OUTPUT);

    // select chip
    _set_chip_enable(true);

    // write data
    _write_eeprom(address, data);

    // deselect chip
    _set_chip_enable(false);

    // wait for write to finish
    long start = millis();
    while (readByte(address) != data)
    {
        if ((millis() - start) >= WRITE_TIMEOUT_MS)
        {
            // write failed
            return false;
        }
    }

    // write ok
    return true;
}

bool writePage(uint16_t start, uint8_t *data, uint16_t len)
{
#pragma region program
    // disable OE
    _set_output_enable(false);
    _set_bus_mode(OUTPUT);

    // select chip
    _set_chip_enable(true);

    // write page in one go
    for (uint16_t i = 0; i < len; i++)
    {
        // set address and data
        _set_addr(i + start);
        _write_bus(data[i]);

        // pulse WE
        _set_write_enable(true);
        // delayMicroseconds(1)
        _set_write_enable(false);
    }
#pragma endregion

#pragma region #DATA polling
    // wait for write to finish
    _set_bus_mode(INPUT);
    _set_output_enable(true);

    // set address to the first byte
    _set_addr(start);

    // wait until the byte is valid
    long tStart = millis();
    while (_read_bus() != data[0])
    {
        if ((millis() - tStart) >= WRITE_TIMEOUT_MS)
        {
            // write failed
            return false;
        }
    }
#pragma endregion

    // deselect chip and disable OE
    _set_output_enable(false);
    _set_chip_enable(false);
    return true;
}

/**
 * enable SDP using brute force, if sdp_enable() does not work.
 * Power-Cycle the device before any write is issued, otherwise writes may be unstable
 * This operation may cause data corruption!
 */
void ensureSDPEnabled()
{
    uint8_t e = readByte(0x00) + 0xF;
    for (;;)
    {
        sdp_enable();
        if (!writeByte(0x00, e))
        {
            return;
        }
    }
}

/**
 * disable SDP using brute force, id sdp_disable() does not work.
 * Power-Cycle the device before any write is issued, otherwise writes may be unstable
 * This operation may cause data corruption!
 */
void ensureSDPDisabled()
{
    uint8_t e = readByte(0x00) + 0xF;
    for (int i = 0; i < 255; i++)
    {
        sdp_disable();

        // disable OE
        _set_output_enable(false);
        _set_bus_mode(OUTPUT);

        // select chip
        _set_chip_enable(true);

        // write data
        _write_eeprom(0, e);

        // deselect chip
        _set_chip_enable(false);
    }
}
