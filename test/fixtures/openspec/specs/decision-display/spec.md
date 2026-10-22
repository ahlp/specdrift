## Purpose

Provide instant daily decision display (SIM or NÃO) regarding urban flooding risk.

## Requirements

### Requirement: Exibir Decisão do Dia Centralizada

The system SHALL display the daily decision in prominent typography (48px+) centered on screen.

#### Scenario: Decisão SIM exibida corretamente com tema alerta

- **GIVEN** Usuário acessa a página sem parâmetros
- **WHEN** A API retorna decisão "SIM"
- **THEN** Página exibe texto "SIM" em fonte 48px centralizado
- **THEN** Tema da página tem cor base #ff4d00

#### Scenario: Decisão NÃO exibida corretamente com tema azul neutro

- **GIVEN** Usuário acessa a página sem parâmetros
- **WHEN** A API retorna decisão "NÃO"
- **THEN** Página exibe texto "NÃO" em fonte 48px centralizado
- **THEN** Tema da página tem cor base #3498db

### Requirement: Navegação para Feed RSS

The system SHALL provide an accessible RSS icon in the header.

#### Scenario: Ícone RSS redireciona para /rss

- **GIVEN** Usuário clica no ícone RSS
- **WHEN** Evento click é disparado
- **THEN** Navega para URL "/rss" sem recarregar a página
