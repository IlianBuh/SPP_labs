# ============================================
# ЗАДАНИЕ 1
# Класс String и методы работы со строками
# ============================================

class String:
    def __init__(self, text):
        self.text = text

    # 1. Длина строки
    def length(self):
        return len(self.text)

    # 2. Переворот строки
    def reverse(self):
        return self.text[::-1]

    # 3. Перевод в верхний регистр
    def to_upper(self):
        return self.text.upper()

    # 4. Перевод в нижний регистр
    def to_lower(self):
        return self.text.lower()

    # 5. Подсчет символа
    def count_char(self, char):
        return self.text.count(char)

    # 6. Замена подстроки
    def replace(self, old, new):
        return self.text.replace(old, new)

    # 7. Проверка на наличие подстроки
    def contains(self, substring):
        return substring in self.text


def task1():
    print("\n========== ЗАДАНИЕ 1 ==========")

    text = input("Введите строку: ")
    string = String(text)

    print("Исходная строка:", string.text)
    print("Длина строки:", string.length())
    print("Перевернутая строка:", string.reverse())
    print("Верхний регистр:", string.to_upper())
    print("Нижний регистр:", string.to_lower())

    char = input("Введите символ для подсчета: ")
    print("Количество символов:", string.count_char(char))

    old = input("Введите подстроку для замены: ")
    new = input("Введите новую подстроку: ")
    print("Результат замены:", string.replace(old, new))

    substring = input("Введите подстроку для поиска: ")
    print("Подстрока найдена:", string.contains(substring))


# ============================================
# ЗАДАНИЕ 2
# Класс Country
# ============================================

class Country:
    def __init__(self, name, capital, area, population):
        self.name = name
        self.capital = capital
        self.area = area
        self.population = population

    def __str__(self):
        return (
            f"{self.name} | Столица: {self.capital} | "
            f"Площадь: {self.area} км² | "
            f"Население: {self.population:,}".replace(",", " ")
        )


def task2():
    print("\n========== ЗАДАНИЕ 2 ==========")

    countries = [
        Country("Россия", "Москва", 17098246, 146000000),
        Country("Канада", "Оттава", 9984670, 40000000),
        Country("Китай", "Пекин", 9596960, 1410000000),
        Country("США", "Вашингтон", 9833517, 335000000),
        Country("Бразилия", "Бразилиа", 8515767, 216000000),
        Country("Индия", "Нью-Дели", 3287263, 1428000000),
    ]

    print("\nСписок всех стран:")
    for country in countries:
        print(country)

    # По заданной площади
    min_area = float(input("\nВведите минимальную площадь страны (км²): "))

    print(f"\nСтраны с площадью >= {min_area} км²:")
    found = False

    for country in countries:
        if country.area >= min_area:
            print(country)
            found = True

    if not found:
        print("Таких стран нет.")

    # По заданной численности населения
    min_population = int(
        input("\nВведите минимальную численность населения: ")
    )

    print(
        f"\nСтраны с населением >= "
        f"{min_population:,}:".replace(",", " ")
    )

    found = False

    for country in countries:
        if country.population >= min_population:
            print(country)
            found = True

    if not found:
        print("Таких стран нет.")


# ============================================
# ЗАДАНИЕ 3
# Зоомагазин, Животное, Рыбы, Птицы
# ============================================

class Animal:
    def __init__(self, breed, price):
        self.breed = breed
        self.price = price

    def movement(self):
        return "Способ передвижения не указан"

    def __str__(self):
        return (
            f"Порода: {self.breed}, "
            f"Стоимость: {self.price} руб., "
            f"Передвижение: {self.movement()}"
        )


class Fish(Animal):
    def movement(self):
        return "Плавает"


class Bird(Animal):
    def movement(self):
        return "Летает"


class ZooShop:
    def __init__(self, name):
        self.name = name
        self.animals = []

    def add_animal(self, animal):
        self.animals.append(animal)

    def show_animals(self):
        print(f"\nЖивотные магазина «{self.name}»:")
        for animal in self.animals:
            print(animal)

    def most_expensive(self):
        if not self.animals:
            return None

        return max(self.animals, key=lambda animal: animal.price)

    def write_to_file(self, filename):
        with open(filename, "w", encoding="utf-8") as file:
            file.write(f"Зоомагазин: {self.name}\n")
            file.write("=" * 50 + "\n")

            for animal in self.animals:
                file.write(str(animal) + "\n")

            expensive = self.most_expensive()

            if expensive:
                file.write("\nСамая дорогая порода:\n")
                file.write(str(expensive) + "\n")


def task3():
    print("\n========== ЗАДАНИЕ 3 ==========")

    shop = ZooShop("Мир животных")

    # Рыбы
    shop.add_animal(Fish("Золотая рыбка", 500))
    shop.add_animal(Fish("Скалярия", 1500))
    shop.add_animal(Fish("Дискус", 5000))

    # Птицы
    shop.add_animal(Bird("Канарейка", 3000))
    shop.add_animal(Bird("Попугай", 7000))
    shop.add_animal(Bird("Ара", 25000))

    # Вывод всех животных
    shop.show_animals()

    # Поиск самой дорогой породы
    expensive = shop.most_expensive()

    print("\nСамая дорогая порода:")
    print(expensive)

    # Запись в файл
    filename = "zoo_shop.txt"
    shop.write_to_file(filename)

    print(f"\nИнформация записана в файл: {filename}")


# ============================================
# ЗАДАНИЕ 4
# Собственный класс BankAccount
# Экземплярный, статический и классовый методы
# ============================================

class BankAccount:
    bank_name = "Python Bank"
    accounts_count = 0

    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance
        BankAccount.accounts_count += 1

    # Метод экземпляра
    def deposit(self, amount):
        if amount > 0:
            self.balance += amount
            print(
                f"{self.owner}: внесено {amount} руб. "
                f"Баланс: {self.balance} руб."
            )
        else:
            print("Сумма должна быть положительной.")

    # Еще один метод экземпляра
    def withdraw(self, amount):
        if amount <= 0:
            print("Сумма должна быть положительной.")
        elif amount > self.balance:
            print("Недостаточно средств.")
        else:
            self.balance -= amount
            print(
                f"{self.owner}: снято {amount} руб. "
                f"Баланс: {self.balance} руб."
            )

    # Статический метод
    @staticmethod
    def is_valid_amount(amount):
        return amount > 0

    # Классовый метод
    @classmethod
    def get_accounts_count(cls):
        return cls.accounts_count

    # Еще один классовый метод
    @classmethod
    def change_bank_name(cls, new_name):
        cls.bank_name = new_name


def task4():
    print("\n========== ЗАДАНИЕ 4 ==========")

    # Создание объектов
    account1 = BankAccount("Иван", 10000)
    account2 = BankAccount("Анна", 25000)

    print("Банк:", BankAccount.bank_name)
    print("Количество счетов:", BankAccount.get_accounts_count())

    print("\n--- Методы экземпляра ---")
    account1.deposit(5000)
    account1.withdraw(3000)

    account2.deposit(10000)
    account2.withdraw(5000)

    print("\n--- Статический метод ---")
    print("Сумма 1000 корректна:",
          BankAccount.is_valid_amount(1000))
    print("Сумма -500 корректна:",
          BankAccount.is_valid_amount(-500))

    print("\n--- Классовый метод ---")
    BankAccount.change_bank_name("Super Python Bank")
    print("Новое название банка:", BankAccount.bank_name)

    print("\nИнформация о счетах:")
    print(account1.owner, "-", account1.balance, "руб.")
    print(account2.owner, "-", account2.balance, "руб.")


# ============================================
# ГЛАВНАЯ ПРОГРАММА
# ============================================

while True:
    print("\n")
    print("=" * 45)
    print("           ВЫБОР ЗАДАНИЯ")
    print("=" * 45)
    print("1 - Класс String")
    print("2 - Страны")
    print("3 - Зоомагазин")
    print("4 - Собственный класс")
    print("0 - Выход")
    print("=" * 45)

    choice = input("Введите номер задания: ")

    if choice == "1":
        task1()

    elif choice == "2":
        task2()

    elif choice == "3":
        task3()

    elif choice == "4":
        task4()

    elif choice == "0":
        print("Программа завершена.")
        break

    else:
        print("Ошибка! Введите число от 1 до 4 или 0 для выхода.")