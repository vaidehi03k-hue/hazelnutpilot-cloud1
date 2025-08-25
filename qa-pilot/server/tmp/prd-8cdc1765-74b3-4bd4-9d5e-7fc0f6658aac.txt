# SauceDemo: 4 Tests (3 pass, 1 fail)

Base URL: https://www.saucedemo.com/

## TC1: Valid login (should PASS)
Given I am on the SauceDemo login page
When I fill Username "standard_user" and Password "secret_sauce" and click Login
Then I see "Products" on the page and the URL contains /inventory

## TC2: Invalid login (should PASS)
Given I am on the SauceDemo login page
When I fill Username "bad" and Password "bad" and click Login
Then I see "Epic sadface:" error message

## TC3: Locked-out user (should PASS)
Given I am on the SauceDemo login page
When I fill Username "locked_out_user" and Password "secret_sauce" and click Login
Then I see "Epic sadface:" error message

## TC4: Intentional fail (should FAIL)
Given I am on the SauceDemo login page
Then I see "Welcome, Vaidehi" on the page
