#include <Arduino.h>
#include "peeprom.hpp"

#define BAUD 115200
#define PKG_START 0x7B
#define PKG_END 0x7D
#define CMD_READ 0xAA
#define CMD_WRITE 0xBB
#define CMD_PAGE_WRITE_START 0xCC
#define CMD_PAGE_WRITE_DATA 0xCD

#define PAGE_SIZE 256
uint8_t pageData[PAGE_SIZE];
uint16_t currentPageAddress = 0;
uint16_t currentPageOffset = 0;

void setup()
{
  Serial.begin(BAUD);
  initEEPROM();

  // if disable of SDP is needed
  // you may have to reprogram & repower if using this
  // ensureSDPDisabled();
}

// stream data in loop()
void loop()
{
  // fast- forward to first start- of- packet
  while (Serial.available() > 0 && Serial.peek() != PKG_START)
  {
    // not yet start- of- packet, ignore this byte
    Serial.read();
  }

  // wait for packet data
  while (Serial.available() >= 6)
  {
    // read data
    uint8_t sop = Serial.read();
    uint8_t cmd = Serial.read();
    uint8_t addr_l = Serial.read();
    uint8_t addr_h = Serial.read();
    uint8_t data = Serial.read();
    uint8_t eop = Serial.read();

    // check packet start and end
    if (sop != PKG_START || eop != PKG_END)
    {
      continue;
    }

    // assemble address
    uint16_t addr = addr_l | (addr_h << 8);

    // check and execute command
    switch (cmd)
    {
    case CMD_READ:
      data = readByte(addr);
      break;
    case CMD_WRITE:
      writeByte(addr, data);
      break;
      // PAGE_WRITE mode is special:
      // the first packet contains information about the start address and the first data byte.
      // following the start packet are 85 data packets carrying three bytes each
      // each packet is ACKd normally, with the data matching the first byte of the packet.
      // after the last data packet is received, the page write begins.
      // page size is fixed to PAGE_SIZE (256 bytes)
      //
      // start packet (1x): <SOP> <CMD_PWS> <A_LO> <A_HI> <DATA> <EOP>
      // data packet (85x): <SOP> <CMD_PWD> <DATA> <DATA> <DATA>  <EOP>
    case CMD_PAGE_WRITE_START:
      // start a page write
      currentPageAddress = addr;
      currentPageOffset = 0;
      pageData[currentPageOffset++] = data;
      break;
    case CMD_PAGE_WRITE_DATA:
      // write data into page buffer
      pageData[currentPageOffset++] = addr_l;
      pageData[currentPageOffset++] = addr_h;
      pageData[currentPageOffset++] = data;

      // start page write
      if (currentPageOffset >= PAGE_SIZE)
      {
        writePage(currentPageAddress, pageData, PAGE_SIZE);

        // response is inverse first byte value
        data = ~addr_l;
      }
      else
      {
        // response is first byte value
        data = addr_l;
      }
      break;
    default:
      break;
    }

    // send response
    Serial.write(sop);
    Serial.write(data);
    Serial.write(~data);
    Serial.write(eop);
  }
}
